import fs from 'node:fs/promises';
import path from 'node:path';
import { Redis } from 'ioredis';
import { config } from '../config.js';

export interface SuggestionNotifyData {
  id: string;
  type: 'RARITY' | 'IMAGE' | 'NEW_CHARACTER' | 'DELETE_CHARACTER';
  characterId?: string | null;
  characterName?: string | null;
  series?: string | null;
  description?: string | null;
  currentRarity?: string | null;
  suggestedRarity?: string | null;
  reason?: string | null;
  imageUrl?: string | null;
  userName?: string | null;
  character?: {
    id: string;
    name: string;
    series: string;
    baseRarity: string;
    imageUrl?: string | null;
  } | null;
}

export class TelegramNotificationService {
  private botToken?: string;
  private chatId?: string;

  constructor(private redis?: Redis) {
    this.botToken = config.TELEGRAM_BOT_TOKEN;
    this.chatId = config.TELEGRAM_CHAT_ID;
  }

  get isConfigured(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  /**
   * Notifica o grupo do Telegram sobre uma nova sugestão enviada no site
   */
  async notifySuggestion(data: SuggestionNotifyData): Promise<void> {
    if (!this.isConfigured) return;

    try {
      let title = '💡 <b>Nova Sugestão de Usuário</b>';
      if (data.type === 'NEW_CHARACTER') title = '✨ <b>Nova Sugestão de Personagem!</b>';
      if (data.type === 'IMAGE') title = '🖼️ <b>Nova Sugestão de Foto!</b>';
      if (data.type === 'RARITY') title = '⭐ <b>Sugestão de Alteração de Raridade!</b>';
      if (data.type === 'DELETE_CHARACTER') title = '🔞 <b>Denúncia de Personagem (Exclusão)!</b>';

      let text = `${title}\n\n`;

      if (data.type === 'NEW_CHARACTER') {
        text += `👤 <b>Personagem:</b> ${this.escapeHtml(data.characterName || 'Sem nome')}\n`;
        text += `📺 <b>Origem / Série:</b> ${this.escapeHtml(data.series || 'Sem série')}\n`;
        text += `⭐ <b>Raridade Sugerida:</b> ${data.suggestedRarity || 'COMMON'}\n`;
        if (data.description) {
          text += `📝 <b>Descrição:</b> <i>${this.escapeHtml(data.description)}</i>\n`;
        }
      } else if (data.character) {
        text += `👤 <b>Personagem:</b> ${this.escapeHtml(data.character.name)} (<code>${data.character.id}</code>)\n`;
        text += `📺 <b>Série:</b> ${this.escapeHtml(data.character.series)}\n`;
        text += `⭐ <b>Raridade Atual:</b> ${data.character.baseRarity}\n`;
        if (data.type === 'RARITY') {
          text += `🎯 <b>Raridade Sugerida:</b> <b>${data.suggestedRarity}</b>\n`;
        }
      }

      if (data.reason) {
        text += `💡 <b>Motivo:</b> <i>${this.escapeHtml(data.reason)}</i>\n`;
      }

      text += `🙋 <b>Sugerido por:</b> ${this.escapeHtml(data.userName || 'Anônimo na Web')}\n`;
      text += `📅 <b>Data:</b> ${new Date().toLocaleString('pt-BR')}`;

      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '✅ Aceitar e Aplicar', callback_data: `sug_app:${data.id}` },
            { text: '❌ Rejeitar', callback_data: `sug_rej:${data.id}` },
          ],
          [
            { text: '🌐 Abrir Painel Admin', url: `${config.PUBLIC_BASE_URL}/admin` },
          ],
        ],
      };

      // Tenta enviar com imagem se houver
      let imageBuffer: Buffer | null = null;
      if (data.imageUrl) {
        try {
          const fullPath = path.isAbsolute(data.imageUrl)
            ? data.imageUrl
            : path.resolve(config.MEDIA_DIR, data.imageUrl);
          imageBuffer = await fs.readFile(fullPath);
        } catch (_) {}
      }

      let sentInfo: { messageId: number; chatId: string } | null = null;
      if (imageBuffer) {
        sentInfo = await this.sendPhotoWithBuffer(imageBuffer, text, replyMarkup);
      } else if (data.character?.imageUrl && data.character.imageUrl.startsWith('http')) {
        sentInfo = await this.sendPhotoWithUrl(data.character.imageUrl, text, replyMarkup);
      } else {
        sentInfo = await this.sendMessage(text, replyMarkup);
      }

      if (sentInfo && this.redis) {
        await this.redis.set(
          `telegram:suggestion:${data.id}:msg`,
          JSON.stringify(sentInfo),
          'EX',
          7 * 86400
        );
      }
    } catch (err: any) {
      console.error('Falha ao enviar notificação para o Telegram:', err?.message || err);
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
      if (data.startsWith('sug_app:')) {
        const suggestionId = data.replace('sug_app:', '');
        await suggestionService.approveSuggestion(suggestionId, `telegram:${moderatorName}`);

        await this.answerCallback(queryId, '✅ Sugestão aceita e aplicada com sucesso!');

        // Atualiza mensagem no Telegram
        const appendText = `\n\n✅ <b>APROVADA E APLICADA</b> por ${this.escapeHtml(moderatorName)} em ${new Date().toLocaleString('pt-BR')}`;
        await this.updateTelegramMessage(chatId, messageId, message, appendText);
      } else if (data.startsWith('sug_rej:')) {
        const suggestionId = data.replace('sug_rej:', '');
        await suggestionService.rejectSuggestion(suggestionId, 'Rejeitado via Telegram', `telegram:${moderatorName}`);

        await this.answerCallback(queryId, '❌ Sugestão rejeitada com sucesso.');

        // Atualiza mensagem no Telegram
        const appendText = `\n\n❌ <b>RECUSADA</b> por ${this.escapeHtml(moderatorName)} em ${new Date().toLocaleString('pt-BR')}`;
        await this.updateTelegramMessage(chatId, messageId, message, appendText);
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

  private async sendMessage(text: string, replyMarkup: any): Promise<{ messageId: number; chatId: string } | null> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
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
      }
    } catch (_) {}
    return null;
  }

  private async sendPhotoWithUrl(photoUrl: string, caption: string, replyMarkup: any): Promise<{ messageId: number; chatId: string } | null> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;
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
      }
    } catch (_) {}
    return null;
  }

  private async sendPhotoWithBuffer(buffer: Buffer, caption: string, replyMarkup: any): Promise<{ messageId: number; chatId: string } | null> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;
      const form = new FormData();
      form.append('chat_id', this.chatId!);
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
      }
    } catch (_) {}
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

      const { chatId, messageId } = JSON.parse(raw);
      if (chatId && messageId) {
        const deleted = await this.deleteMessage(chatId, messageId);
        await r.del(key);
        return deleted;
      }
    } catch (err: any) {
      console.error('Erro ao deletar mensagem de sugestão do Telegram:', err?.message || err);
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

  private async updateTelegramMessage(chatId: string | number, messageId: number, originalMsg: any, appendText: string): Promise<void> {
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
          reply_markup: { inline_keyboard: [] },
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
          reply_markup: { inline_keyboard: [] },
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
