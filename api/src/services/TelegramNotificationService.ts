import fs from 'node:fs/promises';
import path from 'node:path';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { RarityAdvisorService } from './RarityAdvisorService.js';

export interface SuggestionNotifyData {
  id: string;
  type: 'RARITY' | 'IMAGE' | 'NEW_CHARACTER' | 'DELETE_CHARACTER' | 'EDIT';
  characterId?: string | null;
  characterName?: string | null;
  series?: string | null;
  description?: string | null;
  currentRarity?: string | null;
  suggestedRarity?: string | null;
  suggestedName?: string | null;
  suggestedSeries?: string | null;
  suggestedGender?: string | null;
  suggestedDescription?: string | null;
  suggestedTags?: string[] | null;
  photoAction?: 'ADD' | 'DELETE' | 'REPLACE' | null;
  targetPhoto?: string | null;
  reason?: string | null;
  imageUrl?: string | null;
  userName?: string | null;
  userId?: string | null;
  character?: {
    id: string;
    name: string;
    series: string;
    baseRarity: string;
    gender?: string | null;
    description?: string | null;
    tags?: string[] | null;
    imageUrl?: string | null;
    rank?: number | null;
    waifuRank?: number | null;
  } | null;
  marriedUser?: {
    id: string;
    name: string;
  } | null;
  isMarriedToSuggester?: boolean;
  forceNotificationForTest?: boolean;
}

export interface MultiRollReportData {
  id: string;
  slots: Array<{
    slot: number;
    characterId?: string | null;
    characterName?: string | null;
    series?: string | null;
    rarity?: string | null;
    imageUrl?: string | null;
    removed?: boolean;
  }>;
  gridImageBase64?: string | null;
  reason?: string | null;
  userName?: string | null;
  userId?: string | null;
  source?: string | null;
}

export class TelegramNotificationService {
  private botToken?: string;
  private chatId?: string;
  private rarityAdvisorService: RarityAdvisorService;

  constructor(private redis?: Redis) {
    this.botToken = config.TELEGRAM_BOT_TOKEN;
    this.chatId = config.TELEGRAM_CHAT_ID;
    this.rarityAdvisorService = new RarityAdvisorService();
  }

  get isConfigured(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  /**
   * Formata data e hora no fuso horário oficial (Brasília / GMT-3)
   */
  formatBrazilDateTime(date: Date = new Date()): string {
    const formatted = date.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return `${formatted} (GMT-3)`;
  }

  /**
   * Notifica o grupo do Telegram sobre uma nova sugestão enviada no site
   */
  async notifySuggestion(data: SuggestionNotifyData): Promise<void> {
    if (!this.isConfigured) return;

    // Não envia notificações de testes automatizados para o grupo oficial
    if (
      !data.forceNotificationForTest &&
      (process.env.VITEST ||
        process.env.NODE_ENV === 'test' ||
        data.userName === 'teste' ||
        data.userName === 'tester' ||
        data.userId?.startsWith('test_') ||
        data.reason?.toLowerCase().includes('teste automatizado'))
    ) {
      return;
    }

    try {
      let title = '💡 <b>Nova Sugestão de Usuário</b>';
      if (data.type === 'NEW_CHARACTER') title = '✨ <b>Nova Sugestão de Personagem!</b>';
      if (data.type === 'IMAGE') {
        if (data.photoAction === 'DELETE') title = '🗑️ <b>Sugestão de Exclusão de Foto!</b>';
        else if (data.photoAction === 'REPLACE') title = '🔄 <b>Sugestão de Substituição de Foto!</b>';
        else title = '🖼️ <b>Nova Sugestão de Foto!</b>';
      }
      if (data.type === 'RARITY') title = '⭐ <b>Sugestão de Alteração de Raridade!</b>';
      if (data.type === 'DELETE_CHARACTER') title = '🔞 <b>Denúncia de Personagem (Exclusão)!</b>';
      if (data.type === 'EDIT') title = '📝 <b>Sugestão de Edição de Dados do Personagem!</b>';

      let text = `${title}\n\n`;

      if (data.type === 'NEW_CHARACTER') {
        text += `👤 <b>Personagem:</b> ${this.escapeHtml(data.characterName || 'Sem nome')}\n`;
        text += `📺 <b>Origem / Série:</b> ${this.escapeHtml(data.series || 'Sem série')}\n`;
        text += `⭐ <b>Raridade Sugerida:</b> ${data.suggestedRarity || 'COMMON'}\n`;
        if (data.characterId) {
          text += `✨ <i>(Versão Lendária derivada do personagem existente <code>${data.characterId}</code>)</i>\n`;
        }
        if (data.marriedUser) {
          text += `💍 <b>Casamento Original:</b> Casado com <b>${this.escapeHtml(data.marriedUser.name)}</b>\n`;
        }
        if (data.description) {
          text += `📝 <b>Descrição:</b> <i>${this.escapeHtml(data.description)}</i>\n`;
        }
      } else if (data.character) {
        text += `👤 <b>Personagem:</b> ${this.escapeHtml(data.character.name)} (<code>${data.character.id}</code>)\n`;
        text += `📺 <b>Série Atual:</b> ${this.escapeHtml(data.character.series)}\n`;

        // Informações de casamento
        if (data.isMarriedToSuggester) {
          text += `💍 <b>Casamento:</b> ⚠️ <b>ATENÇÃO: Casado com QUEM SUGERIU (${this.escapeHtml(data.marriedUser?.name || data.userName || 'Autor')})!</b> ⚠️\n`;
        } else if (data.marriedUser) {
          text += `💍 <b>Casamento:</b> Casado com <b>${this.escapeHtml(data.marriedUser.name)}</b>\n`;
        }

        if (data.type === 'RARITY') {
          const fromRarity = data.currentRarity || data.character.baseRarity;
          const toRarity = data.suggestedRarity;
          text += `⭐ <b>Mudança de Raridade:</b> <b>${fromRarity} -> ${toRarity}</b>\n`;
        } else if (data.type === 'EDIT') {
          const changes: string[] = [];

          if (data.suggestedName && data.suggestedName.trim() !== data.character.name.trim()) {
            changes.push(`✏️ <b>Nome:</b> ${this.escapeHtml(data.character.name)} ➔ <b>${this.escapeHtml(data.suggestedName.trim())}</b>`);
          }

          if (data.suggestedSeries && data.suggestedSeries.trim() !== data.character.series.trim()) {
            changes.push(`📺 <b>Série:</b> ${this.escapeHtml(data.character.series)} ➔ <b>${this.escapeHtml(data.suggestedSeries.trim())}</b>`);
          }

          if (data.suggestedGender && data.character.gender && data.suggestedGender !== data.character.gender) {
            changes.push(`⚧ <b>Gênero:</b> ${data.character.gender} ➔ <b>${data.suggestedGender}</b>`);
          } else if (data.suggestedGender && !data.character.gender) {
            changes.push(`⚧ <b>Gênero:</b> (não definido) ➔ <b>${data.suggestedGender}</b>`);
          }

          const charRarity = data.character.baseRarity || data.currentRarity;
          if (data.suggestedRarity && charRarity && data.suggestedRarity !== charRarity) {
            changes.push(`⭐ <b>Raridade:</b> <b>${charRarity} -> ${data.suggestedRarity}</b>`);
          }

          const curDesc = (data.character.description || '').trim();
          const sugDesc = (data.suggestedDescription || '').trim();
          if (data.suggestedDescription !== undefined && data.suggestedDescription !== null && sugDesc !== curDesc) {
            changes.push(`📝 <b>Descrição:</b> <i>${this.escapeHtml(curDesc || '(vazia)')}</i> ➔ <i>${this.escapeHtml(sugDesc || '(vazia)')}</i>`);
          }

          const curTags = Array.isArray(data.character.tags) ? data.character.tags : [];
          const sugTags = Array.isArray(data.suggestedTags) ? data.suggestedTags : [];
          const curTagsNorm = [...curTags].sort().join(',');
          const sugTagsNorm = [...sugTags].sort().join(',');
          if (data.suggestedTags && sugTagsNorm !== curTagsNorm) {
            changes.push(`🏷️ <b>Tags:</b> ${this.escapeHtml(curTags.join(', ') || '(nenhuma)')} ➔ <b>${this.escapeHtml(sugTags.join(', ') || '(nenhuma)')}</b>`);
          }

          if (changes.length > 0) {
            text += `\n📋 <b>Campos alterados:</b>\n${changes.join('\n')}\n`;
          } else {
            text += `\n⚠️ <b>Atenção (Sem alterações nos campos):</b>\n`;
            text += `<i>Nenhum campo principal (nome, série, gênero, raridade, tags, descrição) difere do catálogo atual. O usuário pode ter colocado o conteúdo da sugestão no campo de motivo/justificativa abaixo.</i>\n`;
            const currentDesc = data.suggestedDescription || data.character.description;
            if (currentDesc) {
              text += `📖 <b>Descrição Atual no Catálogo:</b> <i>${this.escapeHtml(currentDesc)}</i>\n`;
            }
          }
        } else if (data.type === 'IMAGE') {
          if (data.photoAction === 'DELETE') {
            text += `🗑️ <b>Ação Proposta pelo Usuário:</b> Excluir foto apontada como errada/ruim\n`;
            if (data.targetPhoto) text += `🖼️ <b>Foto Alvo:</b> <code>${this.escapeHtml(data.targetPhoto)}</code>\n`;
          } else if (data.photoAction === 'REPLACE') {
            text += `🔄 <b>Ação Proposta pelo Usuário:</b> Substituir foto atual pela nova foto enviada\n`;
            if (data.targetPhoto) text += `🖼️ <b>Foto Atual (a substituir):</b> <code>${this.escapeHtml(data.targetPhoto)}</code>\n`;
          } else {
            text += `➕ <b>Ação Proposta pelo Usuário:</b> Adicionar nova foto à galeria (mantém foto atual)\n`;
          }
        } else if (data.type === 'DELETE_CHARACTER') {
          text += `🔞 <b>Ação Solicitada:</b> Remoção definitiva do personagem do catálogo\n`;
        }
      }

      if (data.reason) {
        text += `💡 <b>Motivo:</b> <i>${this.escapeHtml(data.reason)}</i>\n`;
      }

      text += `🙋 <b>Sugerido por:</b> ${this.escapeHtml(data.userName || 'Anônimo na Web')}\n`;
      text += `📅 <b>Data:</b> ${this.formatBrazilDateTime()}`;

      const targetCharId = data.characterId || data.character?.id;
      if (targetCharId) {
        const charUrl = `${config.PUBLIC_BASE_URL}/character/${encodeURIComponent(targetCharId)}`;
        text += `\n🔗 <b>Ver Personagem no Site:</b> <a href="${charUrl}">${charUrl}</a>`;
      }

      const isRarityChange =
        data.type === 'RARITY' ||
        (data.type === 'EDIT' && Boolean(data.suggestedRarity && data.suggestedRarity !== data.character?.baseRarity));

      const inlineKeyboard: any[][] = [];

      const navButtons: any[] = [];
      if (targetCharId) {
        navButtons.push({
          text: '👤 Ver Personagem',
          url: `${config.PUBLIC_BASE_URL}/character/${encodeURIComponent(targetCharId)}`,
        });
      }
      navButtons.push({
        text: '🌐 Abrir Painel Admin',
        url: `${config.PUBLIC_BASE_URL}/admin`,
      });

      if (isRarityChange) {
        inlineKeyboard.push([
          { text: '✅ Aceitar', callback_data: `sug_app:${data.id}` },
          { text: '❌ Rejeitar', callback_data: `sug_rej:${data.id}` },
        ]);
        inlineKeyboard.push([
          { text: '⚪ Aceitar - Common', callback_data: `sug_app_rar:${data.id}:COMMON` },
          { text: '🟢 Aceitar - Uncommon', callback_data: `sug_app_rar:${data.id}:UNCOMMON` },
        ]);
        inlineKeyboard.push([
          { text: '🔵 Aceitar - Rare', callback_data: `sug_app_rar:${data.id}:RARE` },
          { text: '🟣 Aceitar - Epic', callback_data: `sug_app_rar:${data.id}:EPIC` },
        ]);
        // Se o personagem já foi casado, a raridade máxima permitida para o mesmo é EPIC
        if (!data.marriedUser) {
          inlineKeyboard.push([
            { text: '🟡 Aceitar - Legendary', callback_data: `sug_app_rar:${data.id}:LEGENDARY` },
          ]);
        }
        inlineKeyboard.push(navButtons);
      } else if (data.type === 'IMAGE' && data.photoAction !== 'DELETE') {
        const proposedAction = data.photoAction === 'REPLACE' ? 'Trocar' : 'Adicionar';
        inlineKeyboard.push([
          { text: `✅ Aceitar Proposto (${proposedAction})`, callback_data: `sug_app:${data.id}` },
        ]);
        inlineKeyboard.push([
          { text: '➕ Aceitar (Nova Foto)', callback_data: `sug_app_img:${data.id}:ADD` },
          { text: '🔄 Aceitar (Trocar Atual)', callback_data: `sug_app_img:${data.id}:REPLACE` },
        ]);
        inlineKeyboard.push([
          { text: '❌ Rejeitar', callback_data: `sug_rej:${data.id}` },
        ]);
        inlineKeyboard.push(navButtons);
      } else {
        inlineKeyboard.push([
          { text: '✅ Aceitar e Aplicar', callback_data: `sug_app:${data.id}` },
          { text: '❌ Rejeitar', callback_data: `sug_rej:${data.id}` },
        ]);
        inlineKeyboard.push(navButtons);
      }

      const replyMarkup = {
        inline_keyboard: inlineKeyboard,
      };

      let sentInfo: { messageId: number; chatId: string } | null = null;
      let albumMessageIds: number[] | null = null;

      // Se for substituição de foto, tenta enviar comparação lado a lado (Foto Atual vs Nova Foto)
      if (data.type === 'IMAGE' && data.photoAction === 'REPLACE') {
        const currBuffer = await this.resolveImageBuffer(
          data.targetPhoto || data.character?.imageUrl,
          data.characterId || data.character?.id
        );
        const newBuffer = await this.resolveImageBuffer(data.imageUrl);

        if (currBuffer && newBuffer) {
          const mediaGroupResult = await this.sendComparisonMediaGroup(
            currBuffer,
            newBuffer,
            '🖼️ <b>Foto 1: Foto Atual no Catálogo</b>',
            '✨ <b>Foto 2: Nova Foto Sugerida (Substituta)</b>'
          );
          if (mediaGroupResult) {
            albumMessageIds = mediaGroupResult.messageIds;
            sentInfo = await this.sendMessage(text, replyMarkup);
          }
        }
      }

      // Se não enviou álbum (não é REPLACE ou imagens indisponíveis), envia foto única ou texto
      if (!sentInfo) {
        let imageBuffer: Buffer | null = null;
        if (data.imageUrl) {
          imageBuffer = await this.resolveImageBuffer(data.imageUrl);
        } else if (data.photoAction === 'DELETE' && data.targetPhoto) {
          imageBuffer = await this.resolveImageBuffer(
            data.targetPhoto,
            data.characterId || data.character?.id
          );
        }

        if (imageBuffer) {
          sentInfo = await this.sendPhotoWithBuffer(imageBuffer, text, replyMarkup);
        } else if (data.character?.imageUrl && data.character.imageUrl.startsWith('http')) {
          sentInfo = await this.sendPhotoWithUrl(data.character.imageUrl, text, replyMarkup);
        }

        // Se o envio da foto falhou ou não há foto, faz fallback garantido para sendMessage
        if (!sentInfo) {
          sentInfo = await this.sendMessage(text, replyMarkup);
        }
      }

      if (sentInfo && this.redis) {
        await this.redis.set(
          `telegram:suggestion:${data.id}:msg`,
          JSON.stringify({
            messageId: sentInfo.messageId,
            chatId: sentInfo.chatId,
            ...(albumMessageIds ? { albumMessageIds } : {}),
          }),
          'EX',
          7 * 86400
        );
      }

      // Se for alteração de raridade, solicita auxílio da IA com ferramentas de busca para subsidiar a decisão
      if (isRarityChange && sentInfo) {
        const targetMessageId = sentInfo.messageId;
        this.rarityAdvisorService
          .evaluateRaritySuggestion(data, this.redis)
          .then(async (advisorEval) => {
            if (advisorEval?.response) {
              const replyInfo = await this.sendMessage(advisorEval.response, undefined, targetMessageId);
              if (replyInfo && this.redis) {
                await this.redis.set(
                  `telegram:suggestion:${data.id}:advisor_msg`,
                  JSON.stringify(replyInfo),
                  'EX',
                  7 * 86400
                );
              }
            }
          })
          .catch((err) => {
            console.error('[TelegramNotificationService] Erro ao obter parecer da IA:', err?.message || err);
          });
      }
    } catch (err: any) {
      console.error('Falha ao enviar notificação para o Telegram:', err?.message || err);
    }
  }

  /**
   * Constrói o teclado inline para denúncia de múltiplos rolls (1, 2, 3...)
   */
  buildMultiRollKeyboard(reportId: string, slots: Array<{ slot: number; removed?: boolean }>): any {
    const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const rows: any[][] = [];
    let currentRow: any[] = [];

    slots.forEach((s) => {
      const numEmoji = numberEmojis[s.slot - 1] || `${s.slot}️⃣`;
      const isRemoved = Boolean(s.removed);

      currentRow.push({
        text: isRemoved ? `${numEmoji} ❌` : numEmoji,
        callback_data: isRemoved ? `mr_done:${reportId}:${s.slot}` : `mr_del:${reportId}:${s.slot}`,
      });

      if (currentRow.length === 5) {
        rows.push(currentRow);
        currentRow = [];
      }
    });

    if (currentRow.length > 0) {
      rows.push(currentRow);
    }

    rows.push([
      { text: '❌ Descartar Denúncia', callback_data: `mr_ign:${reportId}` },
      { text: '🌐 Painel Admin', url: `${config.PUBLIC_BASE_URL}/admin` },
    ]);

    return { inline_keyboard: rows };
  }

  /**
   * Notifica moderação sobre denúncia de múltiplos rolls
   */
  async notifyMultiRollReport(data: MultiRollReportData): Promise<void> {
    if (!this.isConfigured) return;

    // Não envia mensagens de testes automatizados para o grupo oficial
    if (
      process.env.VITEST ||
      process.env.NODE_ENV === 'test' ||
      data.userName?.toLowerCase().includes('teste') ||
      data.userName?.toLowerCase().includes('tester') ||
      data.userId?.startsWith('test_') ||
      data.reason?.toLowerCase().includes('teste de múltiplos rolls')
    ) {
      return;
    }

    try {
      const title = '🚨 <b>Denúncia de Rolls Múltiplos Waifuletes</b> 🚨';
      let text = `${title}\n\n`;
      text += `👤 <b>Denunciante:</b> ${this.escapeHtml(data.userName || 'Anônimo')}\n`;
      if (data.source) {
        text += `👥 <b>Origem:</b> ${this.escapeHtml(data.source)}\n`;
      }
      text += `🎲 <b>Total de Personagens:</b> ${data.slots.length}\n`;
      text += `📅 <b>Data:</b> ${this.formatBrazilDateTime()}\n\n`;

      const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
      const rarityEmoji: Record<string, string> = {
        COMMON: '⚪', COMUM: '⚪',
        UNCOMMON: '🟢', INCOMUM: '🟢',
        RARE: '🔵', RARO: '🔵',
        EPIC: '🟣', EPICO: '🟣', ÉPICO: '🟣',
        LEGENDARY: '🟡', LENDARIO: '🟡', LENDÁRIO: '🟡',
      };

      data.slots.forEach((s) => {
        const numEmoji = numberEmojis[s.slot - 1] || `${s.slot}️⃣`;
        const normRarity = String(s.rarity || 'COMMON').toUpperCase();
        const emoji = rarityEmoji[normRarity] || '⚪';
        const charName = this.escapeHtml(s.characterName || s.characterId || `Personagem #${s.slot}`);
        const series = s.series ? ` — ${this.escapeHtml(s.series)}` : '';
        const charId = s.characterId ? ` (<code>${this.escapeHtml(s.characterId)}</code>)` : '';
        const statusMark = s.removed ? ' <i>(Removido)</i>' : '';

        text += `${numEmoji} ${emoji} [${normRarity}] <b>${charName}</b>${series}${charId}${statusMark}\n`;
      });

      text += `\n<i>Clique no número correspondente abaixo para remover o personagem do catálogo:</i>`;

      const replyMarkup = this.buildMultiRollKeyboard(data.id, data.slots);

      let imageBuffer: Buffer | null = null;
      if (data.gridImageBase64) {
        try {
          const cleanB64 = data.gridImageBase64.replace(/^data:image\/\w+;base64,/, '');
          imageBuffer = Buffer.from(cleanB64, 'base64');
        } catch (_) {}
      }

      let sentInfo: { messageId: number; chatId: string } | null = null;
      if (imageBuffer && imageBuffer.length > 0) {
        sentInfo = await this.sendPhotoWithBuffer(imageBuffer, text, replyMarkup);
      } else {
        sentInfo = await this.sendMessage(text, replyMarkup);
      }

      if (sentInfo && this.redis) {
        await this.redis.set(
          `telegram:multireport:${data.id}:msg`,
          JSON.stringify(sentInfo),
          'EX',
          7 * 86400
        );
        await this.redis.set(
          `telegram:multireport:${data.id}:data`,
          JSON.stringify({
            id: data.id,
            slots: data.slots,
            userName: data.userName,
            source: data.source,
            reason: data.reason,
            chatId: sentInfo.chatId,
            messageId: sentInfo.messageId,
          }),
          'EX',
          7 * 86400
        );
      }
    } catch (err: any) {
      console.error('Falha ao enviar notificação de multi-roll para o Telegram:', err?.message || err);
    }
  }

  /**
   * Processa callback_query disparada ao clicar nos botões inline do Telegram
   */
  async handleCallback(callbackQuery: any, suggestionService: any): Promise<void> {
    if (!this.botToken || !callbackQuery) return;

    const queryId = callbackQuery.id;
    const data = callbackQuery.data as string;
    const fromUser = callbackQuery.from;
    const moderatorName = fromUser
      ? `${fromUser.first_name || ''}${fromUser.username ? ` (@${fromUser.username})` : ''}`.trim()
      : 'Moderador Telegram';

    const message = callbackQuery.message;
    const chatId = message?.chat?.id;
    const messageId = message?.message_id;

    if (!data || !chatId || !messageId) {
      await this.answerCallback(queryId, 'Ação inválida.');
      return;
    }

    try {
      if (data.startsWith('sug_app_img:')) {
        const parts = data.replace('sug_app_img:', '').split(':');
        const suggestionId = parts[0];
        const photoAction = parts[1] as 'ADD' | 'REPLACE';

        await suggestionService.approveSuggestion(suggestionId, `telegram:${moderatorName}`, undefined, photoAction);

        const actionText = photoAction === 'ADD' ? 'Nova foto adicionada à galeria' : 'Foto atual substituída';
        await this.answerCallback(queryId, `✅ Foto aprovada: ${actionText}!`);

        // Atualiza mensagem no Telegram
        const actionLabel = photoAction === 'ADD' ? 'ADICIONADA COMO NOVA FOTO' : 'FOTO ATUAL SUBSTITUÍDA';
        const appendText = `\n\n✅ <b>APROVADA (${actionLabel})</b> por ${this.escapeHtml(moderatorName)} em ${this.formatBrazilDateTime()}`;
        await this.updateTelegramMessage(chatId, messageId, message, appendText);
      } else if (data.startsWith('sug_app_rar:')) {
        const parts = data.replace('sug_app_rar:', '').split(':');
        const suggestionId = parts[0];
        const overrideRarity = parts[1];

        await suggestionService.approveSuggestion(suggestionId, `telegram:${moderatorName}`, overrideRarity);

        await this.answerCallback(queryId, `✅ Sugestão aceita com raridade ${overrideRarity}!`);

        // Atualiza mensagem no Telegram
        const appendText = `\n\n✅ <b>APROVADA (Raridade ${overrideRarity})</b> por ${this.escapeHtml(moderatorName)} em ${this.formatBrazilDateTime()}`;
        await this.updateTelegramMessage(chatId, messageId, message, appendText);
      } else if (data.startsWith('sug_app:')) {
        const suggestionId = data.replace('sug_app:', '');
        await suggestionService.approveSuggestion(suggestionId, `telegram:${moderatorName}`);

        await this.answerCallback(queryId, '✅ Sugestão aceita e aplicada com sucesso!');

        // Atualiza mensagem no Telegram
        const appendText = `\n\n✅ <b>APROVADA E APLICADA</b> por ${this.escapeHtml(moderatorName)} em ${this.formatBrazilDateTime()}`;
        await this.updateTelegramMessage(chatId, messageId, message, appendText);
      } else if (data.startsWith('sug_rej:')) {
        const suggestionId = data.replace('sug_rej:', '');
        await suggestionService.rejectSuggestion(suggestionId, 'Rejeitado via Telegram', `telegram:${moderatorName}`);

        await this.answerCallback(queryId, '❌ Sugestão rejeitada com sucesso.');

        // Atualiza mensagem no Telegram
        const appendText = `\n\n❌ <b>RECUSADA</b> por ${this.escapeHtml(moderatorName)} em ${this.formatBrazilDateTime()}`;
        await this.updateTelegramMessage(chatId, messageId, message, appendText);
      } else if (data.startsWith('mr_del:')) {
        const parts = data.replace('mr_del:', '').split(':');
        const reportId = parts[0];
        const slotNumber = parseInt(parts[1], 10);

        if (!this.redis) {
          await this.answerCallback(queryId, 'Armazenamento temporário indisponível.');
          return;
        }

        const raw = await this.redis.get(`telegram:multireport:${reportId}:data`);
        if (!raw) {
          await this.answerCallback(queryId, 'Denúncia expirada ou não encontrada.');
          return;
        }

        const reportData = JSON.parse(raw);
        const slotItem = reportData.slots.find((s: any) => s.slot === slotNumber);

        if (!slotItem) {
          await this.answerCallback(queryId, 'Slot não encontrado na denúncia.');
          return;
        }

        if (slotItem.removed) {
          await this.answerCallback(queryId, 'Este personagem já foi removido.');
          return;
        }

        if (!slotItem.characterId) {
          await this.answerCallback(queryId, 'ID do personagem não identificado neste slot.');
          return;
        }

        await suggestionService.deactivateCharacter(
          slotItem.characterId,
          `Denúncia em multi-roll (Slot #${slotNumber}) via ${reportData.source || 'WhatsApp'}`,
          `telegram:${moderatorName}`
        );

        slotItem.removed = true;
        await this.redis.set(
          `telegram:multireport:${reportId}:data`,
          JSON.stringify(reportData),
          'EX',
          7 * 86400
        );

        await this.answerCallback(
          queryId,
          `🗑️ Personagem #${slotNumber} (${slotItem.characterName || slotItem.characterId}) removido!`
        );

        const newMarkup = this.buildMultiRollKeyboard(reportId, reportData.slots);
        const appendText = `\n⚠️ Personagem #${slotNumber} (${this.escapeHtml(slotItem.characterName || slotItem.characterId)}) removido por ${this.escapeHtml(moderatorName)} em ${this.formatBrazilDateTime()}.`;
        await this.updateTelegramMessage(chatId, messageId, message, appendText, newMarkup);
      } else if (data.startsWith('mr_done:')) {
        await this.answerCallback(queryId, 'Este personagem já foi removido.');
      } else if (data.startsWith('mr_ign:')) {
        const reportId = data.replace('mr_ign:', '');
        await this.answerCallback(queryId, 'Denúncia finalizada e descartada.');

        const appendText = `\n\n📁 <b>Denúncia finalizada</b> por ${this.escapeHtml(moderatorName)} em ${this.formatBrazilDateTime()}`;
        await this.updateTelegramMessage(chatId, messageId, message, appendText, { inline_keyboard: [] });
      } else {
        await this.answerCallback(queryId, 'Comando não reconhecido.');
      }
    } catch (err: any) {
      console.error('Erro ao processar callback do Telegram:', err?.message || err);
      await this.answerCallback(queryId, `Erro: ${err?.message || 'Falha ao processar.'}`);
    }
  }

  /**
   * Registra webhook no Telegram
   */
  async registerWebhook(publicBaseUrl: string): Promise<boolean> {
    if (!this.botToken) return false;

    try {
      const webhookUrl = `${publicBaseUrl}/api/telegram/webhook`;
      const url = `https://api.telegram.org/bot${this.botToken}/setWebhook`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['callback_query', 'message'],
        }),
      });
      const data = (await res.json()) as any;
      if (data?.ok) {
        console.log(`🤖 Telegram webhook registrado com sucesso em: ${webhookUrl}`);
        return true;
      }
      console.warn('⚠️ Falha ao registrar webhook Telegram:', data);
      return false;
    } catch (err: any) {
      console.warn('⚠️ Erro ao registrar webhook Telegram:', err?.message);
      return false;
    }
  }

  /**
   * Resolve buffer de imagem a partir de caminho relativo, URL ou fallback por characterId
   */
  async resolveImageBuffer(
    imageRef?: string | null,
    characterId?: string | null
  ): Promise<Buffer | null> {
    if (!imageRef && !characterId) return null;

    // 1. Se for URL http / https
    if (imageRef && (imageRef.startsWith('http://') || imageRef.startsWith('https://'))) {
      const mediaIdx = imageRef.indexOf('/media/');
      if (mediaIdx !== -1) {
        const relPath = imageRef.substring(mediaIdx + 7).split('?')[0];
        try {
          const localPath = path.resolve(config.MEDIA_DIR, relPath);
          return await fs.readFile(localPath);
        } catch (_) {}
      }
      try {
        const res = await fetch(imageRef);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          return Buffer.from(ab);
        }
      } catch (_) {}
    }

    // 2. Se for caminho em disco
    if (imageRef) {
      const cleanRef = imageRef.replace(/^\/+/, '');
      const candidates = [
        path.isAbsolute(imageRef) ? imageRef : path.resolve(config.MEDIA_DIR, cleanRef),
        path.resolve(config.MEDIA_DIR, cleanRef),
        path.resolve(config.MEDIA_DIR, 'characters', cleanRef),
        path.resolve(config.MEDIA_DIR, 'uploads', 'characters', cleanRef),
        path.resolve(config.MEDIA_DIR, 'suggestions', cleanRef),
      ];
      for (const p of candidates) {
        try {
          return await fs.readFile(p);
        } catch (_) {}
      }
    }

    // 3. Fallback usando characterId
    if (characterId) {
      const charCandidates = [
        path.resolve(config.MEDIA_DIR, 'characters', characterId, 'default.jpg'),
        path.resolve(config.MEDIA_DIR, 'uploads', 'characters', characterId, 'default.jpg'),
        path.resolve(config.MEDIA_DIR, 'characters', characterId, '0.jpg'),
      ];
      for (const p of charCandidates) {
        try {
          return await fs.readFile(p);
        } catch (_) {}
      }

      try {
        const dir = path.resolve(config.MEDIA_DIR, 'characters', characterId);
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (/\.(jpe?g|png|webp|gif)$/i.test(file)) {
            return await fs.readFile(path.join(dir, file));
          }
        }
      } catch (_) {}
    }

    return null;
  }

  /**
   * Envia 2 fotos lado a lado no Telegram como grupo de mídia (álbum)
   */
  async sendComparisonMediaGroup(
    currPhotoBuffer: Buffer,
    newPhotoBuffer: Buffer,
    currCaption = '🖼️ <b>Foto 1: Foto Atual no Catálogo</b>',
    newCaption = '✨ <b>Foto 2: Nova Foto Sugerida (Substituta)</b>'
  ): Promise<{ messageIds: number[]; chatId: string } | null> {
    if (!this.botToken || !this.chatId) return null;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMediaGroup`;
      const form = new FormData();
      form.append('chat_id', this.chatId);
      form.append(
        'media',
        JSON.stringify([
          {
            type: 'photo',
            media: 'attach://photo_current',
            caption: currCaption,
            parse_mode: 'HTML',
          },
          {
            type: 'photo',
            media: 'attach://photo_new',
            caption: newCaption,
            parse_mode: 'HTML',
          },
        ])
      );
      form.append('photo_current', new Blob([new Uint8Array(currPhotoBuffer)]), 'current.png');
      form.append('photo_new', new Blob([new Uint8Array(newPhotoBuffer)]), 'suggested.png');

      const res = await fetch(url, {
        method: 'POST',
        body: form,
      });
      const data = (await res.json()) as any;
      if (data?.ok && Array.isArray(data.result) && data.result.length > 0) {
        return {
          messageIds: data.result.map((m: any) => m.message_id),
          chatId: String(data.result[0].chat?.id || this.chatId),
        };
      } else {
        console.error('[TelegramNotificationService] sendMediaGroup error:', data?.description || data);
      }
    } catch (err: any) {
      console.error('[TelegramNotificationService] sendMediaGroup exception:', err?.message || err);
    }
    return null;
  }

  private async sendMessage(
    text: string,
    replyMarkup?: any,
    replyToMessageId?: number
  ): Promise<{ messageId: number; chatId: string } | null> {
    if (!this.botToken || !this.chatId) return null;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const payload: any = {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }
      if (replyToMessageId) {
        payload.reply_to_message_id = replyToMessageId;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as any;
      if (data?.ok && data.result?.message_id) {
        return {
          messageId: data.result.message_id,
          chatId: String(data.result.chat?.id || this.chatId),
        };
      } else {
        console.error('[TelegramNotificationService] sendMessage error:', data?.description || data);
        if (data?.description?.includes("can't parse entities")) {
          payload.parse_mode = undefined;
          const retryRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const retryData = (await retryRes.json()) as any;
          if (retryData?.ok && retryData.result?.message_id) {
            return {
              messageId: retryData.result.message_id,
              chatId: String(retryData.result.chat?.id || this.chatId),
            };
          }
        }
      }
    } catch (err: any) {
      console.error('[TelegramNotificationService] sendMessage exception:', err?.message || err);
    }
    return null;
  }

  private async sendPhotoWithUrl(photoUrl: string, caption: string, replyMarkup: any): Promise<{ messageId: number; chatId: string } | null> {
    if (!this.botToken || !this.chatId) return null;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;

      // Se a legenda for maior que o limite de 1024 caracteres do Telegram, envia a foto com cabeçalho limpo e o texto completo logo após
      if (caption.length > 1000) {
        const cleanText = caption.replace(/<[^>]*>/g, '');
        const shortCaption = `💡 <b>Sugestão de Alteração</b>\n\n${this.escapeHtml(cleanText.slice(0, 600))}...\n\n<i>(Detalhes completos na mensagem a seguir)</i>`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            photo: photoUrl,
            caption: shortCaption,
            parse_mode: 'HTML',
          }),
        });
        const data = (await res.json()) as any;
        if (!data?.ok) {
          console.error('[TelegramNotificationService] sendPhotoWithUrl truncated error:', data?.description || data);
          return null;
        }
        return await this.sendMessage(caption, replyMarkup);
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          photo: photoUrl,
          caption,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        }),
      });
      const data = (await res.json()) as any;
      if (data?.ok && data.result?.message_id) {
        return {
          messageId: data.result.message_id,
          chatId: String(data.result.chat?.id || this.chatId),
        };
      } else {
        console.error('[TelegramNotificationService] sendPhotoWithUrl error:', data?.description || data);
      }
    } catch (err: any) {
      console.error('[TelegramNotificationService] sendPhotoWithUrl exception:', err?.message || err);
    }
    return null;
  }

  private async sendPhotoWithBuffer(buffer: Buffer, caption: string, replyMarkup: any): Promise<{ messageId: number; chatId: string } | null> {
    if (!this.botToken || !this.chatId) return null;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;

      // Se a legenda for maior que o limite de 1024 caracteres do Telegram, envia a foto com cabeçalho limpo e o texto completo logo após
      if (caption.length > 1000) {
        const cleanText = caption.replace(/<[^>]*>/g, '');
        const shortCaption = `💡 <b>Sugestão de Alteração</b>\n\n${this.escapeHtml(cleanText.slice(0, 600))}...\n\n<i>(Detalhes completos na mensagem a seguir)</i>`;
        const form = new FormData();
        form.append('chat_id', this.chatId);
        form.append('caption', shortCaption);
        form.append('parse_mode', 'HTML');
        form.append('photo', new Blob([new Uint8Array(buffer)]), 'suggestion.png');

        const res = await fetch(url, { method: 'POST', body: form });
        const data = (await res.json()) as any;
        if (!data?.ok) {
          console.error('[TelegramNotificationService] sendPhoto with truncated caption failed:', data?.description || data);
          return null;
        }
        return await this.sendMessage(caption, replyMarkup);
      }

      const form = new FormData();
      form.append('chat_id', this.chatId);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      form.append('reply_markup', JSON.stringify(replyMarkup));
      form.append('photo', new Blob([new Uint8Array(buffer)]), 'suggestion.png');

      const res = await fetch(url, {
        method: 'POST',
        body: form,
      });
      const data = (await res.json()) as any;
      if (data?.ok && data.result?.message_id) {
        return {
          messageId: data.result.message_id,
          chatId: String(data.result.chat?.id || this.chatId),
        };
      } else {
        console.error('[TelegramNotificationService] sendPhoto error:', data?.description || data);
      }
    } catch (err: any) {
      console.error('[TelegramNotificationService] sendPhoto exception:', err?.message || err);
    }
    return null;
  }

  /**
   * Apaga uma mensagem do Telegram dado chatId e messageId
   */
  async deleteMessage(chatId: string | number, messageId: number): Promise<boolean> {
    if (!this.botToken) return false;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/deleteMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
        }),
      });
      const data = (await res.json()) as any;
      return Boolean(data?.ok);
    } catch (_) {
      return false;
    }
  }

  /**
   * Apaga a mensagem enviada ao Telegram referente a uma sugestão específica
   */
  async deleteSuggestionMessage(suggestionId: string, redis?: Redis): Promise<boolean> {
    const r = redis || this.redis;
    if (!this.botToken || !r) return false;

    try {
      const key = `telegram:suggestion:${suggestionId}:msg`;
      let raw: string | null = null;
      for (let i = 0; i < 5; i++) {
        raw = await r.get(key);
        if (raw) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (!raw) return false;

      const parsed = JSON.parse(raw);
      const { chatId, messageId, albumMessageIds } = parsed;

      // Deleta fotos do álbum se existirem
      if (albumMessageIds && Array.isArray(albumMessageIds)) {
        for (const mid of albumMessageIds) {
          try {
            await this.deleteMessage(chatId, mid);
          } catch (_) {}
        }
      }

      if (chatId && messageId) {
        const deleted = await this.deleteMessage(chatId, messageId);
        await r.del(key);

        // Limpa mensagem de parecer da IA, caso exista
        const advKey = `telegram:suggestion:${suggestionId}:advisor_msg`;
        const advRaw = await r.get(advKey);
        if (advRaw) {
          try {
            const advInfo = JSON.parse(advRaw);
            if (advInfo.chatId && advInfo.messageId) {
              await this.deleteMessage(advInfo.chatId, advInfo.messageId);
              await r.del(advKey);
            }
          } catch (_) {}
        }

        return deleted;
      }
    } catch (err: any) {
      console.error('Erro ao deletar mensagem de sugestão do Telegram:', err?.message || err);
    }
    return false;
  }

  /**
   * Apaga a mensagem enviada ao Telegram referente a uma denúncia de multi-roll
   */
  async deleteMultiReportMessage(reportId: string, redis?: Redis): Promise<boolean> {
    const r = redis || this.redis;
    if (!this.botToken || !r) return false;

    try {
      const key = `telegram:multireport:${reportId}:msg`;
      let raw: string | null = null;
      for (let i = 0; i < 5; i++) {
        raw = await r.get(key);
        if (raw) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (!raw) return false;

      const parsed = JSON.parse(raw);
      const { chatId, messageId, albumMessageIds } = parsed;

      // Deleta fotos do álbum se existirem
      if (albumMessageIds && Array.isArray(albumMessageIds)) {
        for (const mid of albumMessageIds) {
          try {
            await this.deleteMessage(chatId, mid);
          } catch (_) {}
        }
      }

      if (chatId && messageId) {
        const deleted = await this.deleteMessage(chatId, messageId);
        await r.del(key);
        await r.del(`telegram:multireport:${reportId}:data`);
        return deleted;
      }
    } catch (err: any) {
      console.error('Erro ao deletar mensagem de multi-report do Telegram:', err?.message || err);
    }
    return false;
  }

  private async answerCallback(callbackQueryId: string, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: false,
      }),
    });
  }

  private async updateTelegramMessage(
    chatId: string | number,
    messageId: number,
    originalMsg: any,
    appendText: string,
    newReplyMarkup?: any
  ): Promise<void> {
    const markup = newReplyMarkup !== undefined ? newReplyMarkup : { inline_keyboard: [] };
    const isPhoto = Boolean(originalMsg?.photo);
    if (isPhoto) {
      const originalCaption = originalMsg?.caption || '';
      const newCaption = `${originalCaption}${appendText}`;
      const url = `https://api.telegram.org/bot${this.botToken}/editMessageCaption`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          caption: newCaption,
          parse_mode: 'HTML',
          reply_markup: markup,
        }),
      });
    } else {
      const originalText = originalMsg?.text || '';
      const newText = `${originalText}${appendText}`;
      const url = `https://api.telegram.org/bot${this.botToken}/editMessageText`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: newText,
          parse_mode: 'HTML',
          reply_markup: markup,
        }),
      });
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
