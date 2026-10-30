import { PrismaClient, SuggestionType, SuggestionStatus, Rarity, Gender } from '@prisma/client';
import { Redis } from 'ioredis';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { config } from '../config.js';
import { DomainError } from '../errors/DomainError.js';
import { CharacterService, slugify } from './CharacterService.js';
import { TelegramNotificationService } from './TelegramNotificationService.js';
import { NotificationService } from './NotificationService.js';
import { RarityAdvisorService } from './RarityAdvisorService.js';

export type SuggestionBlockDuration = '24h' | '7d' | '30d' | 'forever';

export interface UserSuggestionBlockInfo {
  userId: string;
  duration: SuggestionBlockDuration;
  blockedAt: string;
  expiresAt: string | null;
  reason?: string;
}

export class SuggestionService {
  private telegramService: TelegramNotificationService;
  private notificationService: NotificationService;
  private rarityAdvisorService: RarityAdvisorService;

  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private characterService: CharacterService
  ) {
    this.telegramService = new TelegramNotificationService(this.redis);
    this.notificationService = new NotificationService(this.prisma);
    this.rarityAdvisorService = new RarityAdvisorService();
  }

  /**
   * Obtém informações de casamento de um personagem
   */
  async getCharacterMarriage(characterId: string, suggesterUserId?: string | null) {
    const haremEntry = await this.prisma.haremEntry.findUnique({
      where: { characterId },
      include: {
        user: {
          select: { id: true, name: true, publicId: true },
        },
      },
    });

    if (!haremEntry) {
      return { marriedUser: null, isMarriedToSuggester: false };
    }

    const isMarriedToSuggester = Boolean(suggesterUserId && haremEntry.userId === suggesterUserId);
    return {
      marriedUser: { id: haremEntry.user.id, name: haremEntry.user.name, publicId: haremEntry.user.publicId },
      isMarriedToSuggester,
    };
  }

  /**
   * Verifica se o personagem já foi casado (possui registro atual no harém, já teve claimCount > 0, soulmate ou histórico de divórcio)
   */
  async wasCharacterEverMarried(characterId: string): Promise<boolean> {
    const cleanId = String(characterId).trim();
    const [haremEntry, character, soulmate, divorceTx] = await Promise.all([
      this.prisma.haremEntry.findFirst({
        where: { characterId: cleanId },
        select: { id: true },
      }),
      this.prisma.character.findFirst({
        where: {
          OR: [
            { id: cleanId },
            { id: cleanId.toLowerCase() },
          ],
        },
        select: { id: true, claimCount: true },
      }),
      this.prisma.soulmate.findFirst({
        where: { characterId: cleanId },
        select: { id: true },
      }),
      this.prisma.kakeraTransaction.findFirst({
        where: {
          reason: 'DIVORCE',
          metadata: {
            path: ['characterId'],
            equals: cleanId,
          },
        },
        select: { id: true },
      }),
    ]);

    return Boolean(
      haremEntry ||
      (character && character.claimCount > 0) ||
      soulmate ||
      divorceTx
    );
  }

  /**
   * Bloqueia um usuário para impedi-lo de enviar sugestões (24h, 7d, 30d ou pra sempre)
   */
  async blockUserFromSuggestions(
    userIdOrPublicId: string,
    duration: SuggestionBlockDuration,
    reason = 'Suspeita de spam'
  ): Promise<UserSuggestionBlockInfo> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userIdOrPublicId }, { publicId: userIdOrPublicId }] },
      select: { id: true, publicId: true, name: true },
    });

    if (!user) {
      throw new DomainError('USER_NOT_FOUND', 'Usuário não encontrado.', 404);
    }

    const DURATION_SECONDS: Record<SuggestionBlockDuration, number> = {
      '24h': 86400,
      '7d': 7 * 86400,
      '30d': 30 * 86400,
      'forever': -1,
    };

    const seconds = DURATION_SECONDS[duration];
    if (seconds === undefined) {
      throw new DomainError('INVALID_DURATION', 'Duração de bloqueio inválida. Use: 24h, 7d, 30d ou forever.', 400);
    }

    const now = new Date();
    const expiresAt = seconds > 0 ? new Date(now.getTime() + seconds * 1000).toISOString() : null;

    const blockInfo: UserSuggestionBlockInfo = {
      userId: user.id,
      duration,
      blockedAt: now.toISOString(),
      expiresAt,
      reason,
    };

    const payload = JSON.stringify(blockInfo);

    if (seconds > 0) {
      await this.redis.set(`suggestion:block:${user.id}`, payload, 'EX', seconds);
      await this.redis.set(`suggestion:block:${user.publicId}`, payload, 'EX', seconds);
    } else {
      await this.redis.set(`suggestion:block:${user.id}`, payload);
      await this.redis.set(`suggestion:block:${user.publicId}`, payload);
    }

    return blockInfo;
  }

  /**
   * Desbloqueia um usuário para voltar a enviar sugestões
   */
  async unblockUserFromSuggestions(userIdOrPublicId: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userIdOrPublicId }, { publicId: userIdOrPublicId }] },
      select: { id: true, publicId: true },
    });

    if (user) {
      await this.redis.del(`suggestion:block:${user.id}`, `suggestion:block:${user.publicId}`);
    } else {
      await this.redis.del(`suggestion:block:${userIdOrPublicId}`);
    }
    return true;
  }

  /**
   * Consulta se o usuário está bloqueado de enviar sugestões
   */
  async getUserSuggestionBlock(userIdOrPublicId: string): Promise<UserSuggestionBlockInfo | null> {
    const raw = await this.redis.get(`suggestion:block:${userIdOrPublicId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  /**
   * Valida se o usuário pode enviar sugestões. Se estiver bloqueado, lança DomainError 403.
   */
  async assertUserNotBlocked(userIdOrPublicId: string): Promise<void> {
    const block = await this.getUserSuggestionBlock(userIdOrPublicId);
    if (block) {
      throw new DomainError(
        'SUGGESTIONS_BLOCKED',
        'Você está temporariamente impedido de enviar sugestões por suspeita de spam.',
        403
      );
    }
  }

  /**
   * Envia uma sugestão de nova raridade para um personagem
   */
  async submitRaritySuggestion(userId: string, characterId: string, suggestedRarity: Rarity, reason: string) {
    const character = await this.characterService.findCharacter(characterId);
    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.', 404);
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      throw new DomainError('REASON_REQUIRED', 'É obrigatório informar uma justificativa clara (mínimo de 5 caracteres) para a mudança de raridade.', 400);
    }

    if (character.baseRarity === suggestedRarity) {
      throw new DomainError('SAME_RARITY', 'A raridade sugerida é exatamente igual à raridade atual do personagem.', 400);
    }

    if (suggestedRarity === 'LEGENDARY') {
      const wasMarried = await this.wasCharacterEverMarried(character.id);
      if (wasMarried) {
        throw new DomainError(
          'MARRIED_CHARACTER_MAX_EPIC',
          'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Para sugerir a versão Lendária, é necessário criar um novo personagem fornecendo uma nova foto.',
          400
        );
      }
    }

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { publicId: userId }] },
      select: { id: true, name: true },
    });
    if (!user) {
      throw new DomainError('USER_NOT_FOUND', 'Usuário não encontrado.', 404);
    }

    await this.assertUserNotBlocked(user.id);

    const fingerprint = createHash('sha256')
      .update(`rarity:${user.id}:${character.id}:${suggestedRarity}`)
      .digest('hex');

    return this.executeWithDebounce(fingerprint, async () => {
      const suggestion = await this.prisma.characterSuggestion.create({
        data: {
          characterId: character.id,
          userId: user.id,
          type: 'RARITY',
          status: 'PENDING',
          currentRarity: character.baseRarity,
          suggestedRarity,
          reason: reason.trim(),
        },
        include: {
          character: {
            select: { id: true, name: true, series: true, baseRarity: true, imageUrls: true },
          },
        },
      });

      const marriageInfo = await this.getCharacterMarriage(character.id, user.id);

      // Notifica Telegram
      await this.telegramService.notifySuggestion({
        id: suggestion.id,
        type: 'RARITY',
        characterId: character.id,
        currentRarity: character.baseRarity,
        suggestedRarity,
        reason: reason.trim(),
        userName: user?.name || userId,
        userId: user.id,
        character: {
          id: character.id,
          name: character.name,
          series: character.series,
          baseRarity: character.baseRarity,
          gender: character.gender,
          description: character.description,
          tags: character.tags,
          imageUrl: this.characterService.getRandomImageUrl(character.id, character.imageUrls),
          rank: character.rank,
          waifuRank: character.waifuRank,
        },
        marriedUser: marriageInfo.marriedUser,
        isMarriedToSuggester: marriageInfo.isMarriedToSuggester,
      }).catch((err) => console.error('Telegram notification error:', err));

      return suggestion;
    });
  }

  /**
   * Envia uma sugestão de foto (adicionar nova, excluir errada ou substituir por outra)
   */
  async submitImageSuggestion(
    userId: string,
    characterId: string,
    imageBuffer?: Buffer | null,
    reason?: string,
    action: 'ADD' | 'DELETE' | 'REPLACE' = 'ADD',
    targetPhoto?: string
  ) {
    const character = await this.characterService.findCharacter(characterId);
    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.', 404);
    }

    if (action === 'DELETE') {
      if (!targetPhoto) {
        throw new DomainError('TARGET_PHOTO_REQUIRED', 'É obrigatório selecionar a foto a ser excluída.', 400);
      }
      if (!reason || reason.trim().length < 5) {
        throw new DomainError('REASON_REQUIRED', 'É obrigatório informar o motivo da exclusão da foto (mínimo de 5 caracteres).', 400);
      }
    } else {
      if (!imageBuffer || imageBuffer.length === 0) {
        throw new DomainError('IMAGE_REQUIRED', 'Buffer de imagem não fornecido ou vazio.', 400);
      }
      if (action === 'REPLACE' && !targetPhoto) {
        throw new DomainError('TARGET_PHOTO_REQUIRED', 'É obrigatório selecionar a foto a ser substituída.', 400);
      }
    }

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { publicId: userId }] },
      select: { id: true, name: true },
    });
    if (!user) {
      throw new DomainError('USER_NOT_FOUND', 'Usuário não encontrado.', 404);
    }

    await this.assertUserNotBlocked(user.id);

    const imgHash = imageBuffer ? createHash('md5').update(imageBuffer).digest('hex') : 'no_img';
    const fingerprint = createHash('sha256')
      .update(`image:${user.id}:${character.id}:${action}:${targetPhoto || ''}:${imgHash}`)
      .digest('hex');

    return this.executeWithDebounce(fingerprint, async () => {
      let relPath: string | null = null;
      const suggestionId = randomUUID();

      if (imageBuffer && imageBuffer.length > 0) {
        const fileName = `${suggestionId}.png`;
        const suggestionsDir = path.resolve(config.MEDIA_DIR, 'suggestions');

        await fs.mkdir(suggestionsDir, { recursive: true });
        const filePath = path.join(suggestionsDir, fileName);
        await fs.writeFile(filePath, imageBuffer);

        relPath = `suggestions/${fileName}`;
      }

      const actionMetadata = JSON.stringify({ action, targetPhoto: targetPhoto || null });

      const suggestion = await this.prisma.characterSuggestion.create({
        data: {
          id: suggestionId,
          characterId: character.id,
          userId: user.id,
          type: 'IMAGE',
          status: 'PENDING',
          imageUrl: relPath,
          description: actionMetadata,
          reason: reason ? reason.trim() : null,
        },
        include: {
          character: {
            select: { id: true, name: true, series: true, baseRarity: true, imageUrls: true },
          },
        },
      });

      const marriageInfo = await this.getCharacterMarriage(character.id, user.id);

      // Notifica Telegram
      await this.telegramService.notifySuggestion({
        id: suggestion.id,
        type: 'IMAGE',
        characterId: character.id,
        imageUrl: relPath,
        photoAction: action,
        targetPhoto,
        reason: reason ? reason.trim() : null,
        userName: user.name || userId,
        userId: user.id,
        character: {
          id: character.id,
          name: character.name,
          series: character.series,
          baseRarity: character.baseRarity,
          gender: character.gender,
          description: character.description,
          tags: character.tags,
          imageUrl: this.characterService.getRandomImageUrl(character.id, character.imageUrls),
          rank: character.rank,
          waifuRank: character.waifuRank,
        },
        marriedUser: marriageInfo.marriedUser,
        isMarriedToSuggester: marriageInfo.isMarriedToSuggester,
      }).catch((err) => console.error('Telegram notification error:', err));

      return suggestion;
    });
  }

  /**
   * Envia uma sugestão de edição de informações do personagem (nome, série, gênero, descrição, raridade, tags)
   */
  async submitEditSuggestion(
    userId: string,
    characterId: string,
    data: {
      suggestedName?: string;
      suggestedSeries?: string;
      suggestedGender?: Gender;
      suggestedDescription?: string;
      suggestedRarity?: Rarity;
      suggestedTags?: string[];
      reason: string;
    }
  ) {
    const character = await this.characterService.findCharacter(characterId);
    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.', 404);
    }

    if (!data.reason || typeof data.reason !== 'string' || data.reason.trim().length < 5) {
      throw new DomainError('REASON_REQUIRED', 'É obrigatório informar uma justificativa clara (mínimo de 5 caracteres) para as alterações.', 400);
    }

    const curTagsNorm = [...(character.tags || [])].sort().join(',');
    const sugTagsNorm = [...(data.suggestedTags || [])].sort().join(',');
    const tagsChanged = data.suggestedTags !== undefined && sugTagsNorm !== curTagsNorm;

    const hasChanges = Boolean(
      (data.suggestedName && data.suggestedName.trim() !== character.name.trim()) ||
      (data.suggestedSeries && data.suggestedSeries.trim() !== character.series.trim()) ||
      (data.suggestedGender && data.suggestedGender !== character.gender) ||
      (data.suggestedDescription !== undefined && data.suggestedDescription.trim() !== (character.description || '').trim()) ||
      (data.suggestedRarity && data.suggestedRarity !== character.baseRarity) ||
      tagsChanged
    );

    if (!hasChanges) {
      throw new DomainError('NO_CHANGES', 'Nenhuma alteração foi sugerida em relação aos dados atuais do personagem. Altere ao menos um campo (nome, série, gênero, raridade, tags ou descrição) antes de enviar.', 400);
    }

    if (data.suggestedRarity === 'LEGENDARY') {
      const wasMarried = await this.wasCharacterEverMarried(character.id);
      if (wasMarried) {
        throw new DomainError(
          'MARRIED_CHARACTER_MAX_EPIC',
          'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Para sugerir a versão Lendária, é necessário criar um novo personagem fornecendo uma nova foto.',
          400
        );
      }
    }

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { publicId: userId }] },
      select: { id: true, name: true },
    });
    if (!user) {
      throw new DomainError('USER_NOT_FOUND', 'Usuário não encontrado.', 404);
    }

    await this.assertUserNotBlocked(user.id);

    const fingerprint = createHash('sha256')
      .update(
        `edit:${user.id}:${character.id}:${data.suggestedName || ''}:${data.suggestedSeries || ''}:${data.suggestedGender || ''}:${data.suggestedRarity || ''}:${(data.suggestedTags || []).join(',')}:${data.suggestedDescription || ''}`
      )
      .digest('hex');

    return this.executeWithDebounce(fingerprint, async () => {
      const suggestion = await this.prisma.characterSuggestion.create({
        data: {
          characterId: character.id,
          userId: user.id,
          type: 'EDIT',
          status: 'PENDING',
          characterName: character.name,
          series: character.series,
          description: character.description,
          currentRarity: character.baseRarity,
          suggestedName: data.suggestedName?.trim() || null,
          suggestedSeries: data.suggestedSeries?.trim() || null,
          suggestedGender: data.suggestedGender || null,
          suggestedDescription: data.suggestedDescription !== undefined ? data.suggestedDescription.trim() : null,
          suggestedRarity: data.suggestedRarity || null,
          suggestedTags: data.suggestedTags || [],
          reason: data.reason.trim(),
        },
        include: {
          character: {
            select: { id: true, name: true, series: true, baseRarity: true, imageUrls: true },
          },
        },
      });

      const marriageInfo = await this.getCharacterMarriage(character.id, user.id);

      // Notifica Telegram
      await this.telegramService.notifySuggestion({
        id: suggestion.id,
        type: 'EDIT',
        characterId: character.id,
        suggestedName: data.suggestedName?.trim() || null,
        suggestedSeries: data.suggestedSeries?.trim() || null,
        suggestedGender: data.suggestedGender || null,
        suggestedDescription: data.suggestedDescription !== undefined ? data.suggestedDescription.trim() : null,
        suggestedRarity: data.suggestedRarity || null,
        suggestedTags: data.suggestedTags || null,
        reason: data.reason.trim(),
        userName: user.name || userId,
        userId: user.id,
        character: {
          id: character.id,
          name: character.name,
          series: character.series,
          baseRarity: character.baseRarity,
          gender: character.gender,
          description: character.description,
          tags: character.tags,
          imageUrl: this.characterService.getRandomImageUrl(character.id, character.imageUrls),
          rank: character.rank,
          waifuRank: character.waifuRank,
        },
        marriedUser: marriageInfo.marriedUser,
        isMarriedToSuggester: marriageInfo.isMarriedToSuggester,
      }).catch((err) => console.error('Telegram notification error:', err));

      return suggestion;
    });
  }

  /**
   * Envia uma sugestão de NOVO personagem para o catálogo
   */
  async submitNewCharacterSuggestion(
    userId: string,
    data: {
      name: string;
      series: string;
      rarity: Rarity;
      gender?: Gender;
      tags?: string[];
      description?: string;
      reason?: string;
      imageBuffer?: Buffer;
      originCharacterId?: string;
    }
  ) {
    if (!data.name || data.name.trim().length < 2) {
      throw new DomainError('INVALID_NAME', 'O nome do personagem deve conter ao menos 2 caracteres.', 400);
    }

    if (!data.series || data.series.trim().length < 2) {
      throw new DomainError('INVALID_SERIES', 'A série/origem deve conter ao menos 2 caracteres.', 400);
    }

    if (data.rarity === 'LEGENDARY' && (!data.imageBuffer || data.imageBuffer.length === 0)) {
      throw new DomainError('IMAGE_REQUIRED', 'É obrigatório fornecer uma nova foto para sugerir um personagem na raridade Lendária.', 400);
    }

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { publicId: userId }] },
      select: { id: true, name: true },
    });
    if (!user) {
      throw new DomainError('USER_NOT_FOUND', 'Usuário não encontrado.', 404);
    }

    await this.assertUserNotBlocked(user.id);

    const imgHash = data.imageBuffer ? createHash('md5').update(data.imageBuffer).digest('hex') : 'no_img';
    const fingerprint = createHash('sha256')
      .update(
        `new_char:${user.id}:${data.name.trim().toLowerCase()}:${data.series.trim().toLowerCase()}:${data.rarity}:${data.originCharacterId || ''}:${imgHash}`
      )
      .digest('hex');

    return this.executeWithDebounce(fingerprint, async () => {
      let relPath: string | null = null;
      const suggestionId = randomUUID();

      if (data.imageBuffer && data.imageBuffer.length > 0) {
        const fileName = `${suggestionId}.png`;
        const suggestionsDir = path.resolve(config.MEDIA_DIR, 'suggestions');
        await fs.mkdir(suggestionsDir, { recursive: true });
        const filePath = path.join(suggestionsDir, fileName);
        await fs.writeFile(filePath, data.imageBuffer);
        relPath = `suggestions/${fileName}`;
      }

      const suggestion = await this.prisma.characterSuggestion.create({
        data: {
          id: suggestionId,
          characterId: data.originCharacterId || null,
          userId: user.id,
          type: 'NEW_CHARACTER',
          status: 'PENDING',
          characterName: data.name.trim(),
          series: data.series.trim(),
          description: data.description ? data.description.trim() : null,
          suggestedRarity: data.rarity || 'COMMON',
          suggestedGender: data.gender || 'FEMALE',
          suggestedTags: data.tags || [],
          imageUrl: relPath,
          reason: data.reason ? data.reason.trim() : null,
        },
      });

      let marriageInfo: any = { marriedUser: null, isMarriedToSuggester: false };
      let originChar: any = null;
      if (data.originCharacterId) {
        originChar = await this.characterService.findCharacter(data.originCharacterId);
        marriageInfo = await this.getCharacterMarriage(data.originCharacterId, user.id);
      }

      // Notifica Telegram
      await this.telegramService.notifySuggestion({
        id: suggestion.id,
        type: 'NEW_CHARACTER',
        characterId: data.originCharacterId || undefined,
        characterName: data.name.trim(),
        series: data.series.trim(),
        description: data.description ? data.description.trim() : null,
        suggestedRarity: data.rarity || 'COMMON',
        imageUrl: relPath,
        reason: data.reason ? data.reason.trim() : null,
        userName: user.name || userId,
        userId: user.id,
        character: originChar ? {
          id: originChar.id,
          name: originChar.name,
          series: originChar.series,
          baseRarity: originChar.baseRarity,
          gender: originChar.gender,
          description: originChar.description,
          tags: originChar.tags,
          imageUrl: this.characterService.getRandomImageUrl(originChar.id, originChar.imageUrls),
        } : undefined,
        marriedUser: marriageInfo.marriedUser,
        isMarriedToSuggester: marriageInfo.isMarriedToSuggester,
      }).catch((err) => console.error('Telegram notification error:', err));

      return suggestion;
    });
  }

  /**
   * Envia uma denúncia de exclusão para um personagem (botão 🔞 na home ou comando WhatsApp)
   */
  async submitDeleteSuggestion(characterId: string, userId?: string, reason?: string, explicitUserName?: string) {
    const character = await this.characterService.findCharacter(characterId);
    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.', 404);
    }

    let userName = explicitUserName || 'Anônimo na Web';
    let resolvedUserId: string | null = null;
    if (userId) {
      const user = await this.prisma.user.findFirst({
        where: { OR: [{ id: userId }, { publicId: userId }] },
        select: { id: true, name: true },
      });
      if (user) {
        resolvedUserId = user.id;
        if (!explicitUserName && user.name) userName = user.name;
      }
    }

    if (resolvedUserId) {
      await this.assertUserNotBlocked(resolvedUserId);
    } else if (userId) {
      await this.assertUserNotBlocked(userId);
    }

    const fingerprint = createHash('sha256')
      .update(`delete:${resolvedUserId || userId || 'anon'}:${character.id}:${(reason || '').trim()}`)
      .digest('hex');

    return this.executeWithDebounce(fingerprint, async () => {
      const suggestion = await this.prisma.characterSuggestion.create({
        data: {
          characterId: character.id,
          userId: resolvedUserId,
          type: 'DELETE_CHARACTER',
          status: 'PENDING',
          reason: reason ? reason.trim() : 'Conteúdo inadequado ou denúncia de exclusão (🔞).',
        },
        include: {
          character: {
            select: { id: true, name: true, series: true, baseRarity: true, imageUrls: true },
          },
        },
      });

      const marriageInfo = await this.getCharacterMarriage(character.id, resolvedUserId);

      // Notifica Telegram
      await this.telegramService.notifySuggestion({
        id: suggestion.id,
        type: 'DELETE_CHARACTER',
        characterId: character.id,
        reason: reason ? reason.trim() : 'Conteúdo inadequado ou denúncia de exclusão (🔞).',
        userName,
        userId: resolvedUserId,
        character: {
          id: character.id,
          name: character.name,
          series: character.series,
          baseRarity: character.baseRarity,
          gender: character.gender,
          description: character.description,
          tags: character.tags,
          imageUrl: this.characterService.getRandomImageUrl(character.id, character.imageUrls),
          rank: character.rank,
          waifuRank: character.waifuRank,
        },
        marriedUser: marriageInfo.marriedUser,
        isMarriedToSuggester: marriageInfo.isMarriedToSuggester,
      }).catch((err) => console.error('Telegram notification error:', err));

      return suggestion;
    });
  }

  /**
   * Lista sugestões com filtros e paginação
   */
  async listSuggestions(filter: {
    status?: SuggestionStatus | 'all';
    type?: SuggestionType;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.status && filter.status !== 'all') {
      where.status = filter.status;
    }
    if (filter.type) {
      where.type = filter.type;
    }

    const [total, suggestions] = await Promise.all([
      this.prisma.characterSuggestion.count({ where }),
      this.prisma.characterSuggestion.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }],
        include: {
          character: {
            select: {
              id: true,
              name: true,
              series: true,
              baseRarity: true,
              gender: true,
              description: true,
              tags: true,
              imageUrls: true,
              haremEntries: {
                select: {
                  user: {
                    select: { id: true, name: true, publicId: true },
                  },
                },
              },
            },
          },
          user: {
            select: { id: true, publicId: true, name: true },
          },
        },
      }),
    ]);

    const userIds = [...new Set(suggestions.map((s) => s.userId).filter(Boolean))] as string[];
    const blockMap: Record<string, UserSuggestionBlockInfo> = {};
    if (userIds.length > 0) {
      const blockKeys = userIds.map((uid) => `suggestion:block:${uid}`);
      const rawBlocks = await this.redis.mget(blockKeys);
      rawBlocks.forEach((b) => {
        if (b) {
          try {
            const parsed = JSON.parse(b);
            if (parsed?.userId) {
              blockMap[parsed.userId] = parsed;
            }
          } catch (_) {}
        }
      });
    }

    const advisorKeys = suggestions.map((s) => `suggestion:ai:${s.id}`);
    const rawAdvisors = advisorKeys.length > 0 ? await this.redis.mget(advisorKeys) : [];
    const advisorMap: Record<string, any> = {};
    rawAdvisors.forEach((raw, idx) => {
      if (raw) {
        try {
          advisorMap[suggestions[idx].id] = JSON.parse(raw);
        } catch (_) {}
      }
    });

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: suggestions.map((s) => {
        let actionData: { action?: string; targetPhoto?: string } | null = null;
        if (s.type === 'IMAGE' && s.description) {
          try {
            actionData = JSON.parse(s.description);
          } catch (_) {}
        }

        const marriedUser = s.character?.haremEntries?.[0]?.user || null;
        const isMarriedToSuggester = Boolean(marriedUser && s.userId && marriedUser.id === s.userId);
        const userBlock = s.userId ? blockMap[s.userId] || null : null;

        return {
          id: s.id,
          characterId: s.characterId,
          userId: s.userId,
          type: s.type,
          status: s.status,
          characterName: s.characterName,
          series: s.series,
          description: s.description,
          actionData,
          aiAdvisor: advisorMap[s.id] || null,
          currentRarity: s.currentRarity,
          suggestedRarity: s.suggestedRarity,
          suggestedName: s.suggestedName,
          suggestedSeries: s.suggestedSeries,
          suggestedGender: s.suggestedGender,
          suggestedDescription: s.suggestedDescription,
          suggestedTags: s.suggestedTags,
          reason: s.reason,
          imageUrl: s.imageUrl ? `${config.PUBLIC_BASE_URL}/media/${s.imageUrl}` : null,
          rawImageUrl: s.imageUrl,
          reviewedAt: s.reviewedAt,
          reviewedBy: s.reviewedBy,
          rejectionReason: s.rejectionReason,
          createdAt: s.createdAt,
          marriage: marriedUser ? { id: marriedUser.id, name: marriedUser.name, publicId: marriedUser.publicId } : null,
          isMarriedToSuggester,
          isUserBlocked: Boolean(userBlock),
          userBlockInfo: userBlock,
          character: s.character
            ? {
                ...s.character,
                imageUrl: this.characterService.getRandomImageUrl(s.character.id, s.character.imageUrls),
                imageUrls: s.character.imageUrls.map((img) => this.characterService.formatImageUrl(s.character!.id, img)),
                rawImageUrls: s.character.imageUrls,
              }
            : null,
          user: s.user
            ? {
                id: s.user.id,
                name: s.user.name,
                publicId: s.user.publicId,
              }
            : null,
        };
      }),
    };
  }

  /**
   * Lista sugestões de um usuário específico
   */
  async listUserSuggestions(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { publicId: userId }] },
      select: { id: true },
    });
    const targetUserId = user ? user.id : userId;

    const suggestions = await this.prisma.characterSuggestion.findMany({
      where: { userId: targetUserId },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        character: {
          select: { id: true, name: true, series: true, baseRarity: true, imageUrls: true },
        },
      },
    });

    return suggestions.map((s) => {
      let actionData: { action?: string; targetPhoto?: string } | null = null;
      if (s.type === 'IMAGE' && s.description) {
        try {
          actionData = JSON.parse(s.description);
        } catch (_) {}
      }

      return {
        id: s.id,
        characterId: s.characterId,
        type: s.type,
        status: s.status,
        characterName: s.characterName,
        series: s.series,
        description: s.description,
        actionData,
        currentRarity: s.currentRarity,
        suggestedRarity: s.suggestedRarity,
        suggestedName: s.suggestedName,
        suggestedSeries: s.suggestedSeries,
        suggestedGender: s.suggestedGender,
        suggestedDescription: s.suggestedDescription,
        suggestedTags: s.suggestedTags,
        reason: s.reason,
        imageUrl: s.imageUrl ? `${config.PUBLIC_BASE_URL}/media/${s.imageUrl}` : null,
        reviewedAt: s.reviewedAt,
        reviewedBy: s.reviewedBy,
        rejectionReason: s.rejectionReason,
        createdAt: s.createdAt,
        character: s.character
          ? {
              ...s.character,
              imageUrl: this.characterService.getRandomImageUrl(s.character.id, s.character.imageUrls),
              imageUrls: s.character.imageUrls.map((img) => this.characterService.formatImageUrl(s.character!.id, img)),
              rawImageUrls: s.character.imageUrls,
            }
          : null,
      };
    });
  }

  /**
   * Aceita uma sugestão e aplica a alteração automaticamente
   */
  async approveSuggestion(
    suggestionId: string,
    reviewedBy = 'admin',
    overrideRarity?: string,
    overridePhotoAction?: 'ADD' | 'REPLACE'
  ) {
    const suggestion = await this.prisma.characterSuggestion.findUnique({
      where: { id: suggestionId },
      include: { character: true },
    });

    if (!suggestion) {
      throw new DomainError('SUGGESTION_NOT_FOUND', 'Sugestão não encontrada.', 404);
    }

    if (suggestion.status !== 'PENDING') {
      throw new DomainError('SUGGESTION_ALREADY_REVIEWED', `Esta sugestão já foi avaliada anteriormente (${suggestion.status}).`, 400);
    }

    const validRarities = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
    const chosenRarity = overrideRarity && validRarities.includes(overrideRarity.toUpperCase())
      ? (overrideRarity.toUpperCase() as Rarity)
      : null;

    let successMessage = 'Sugestão aprovada e aplicada com sucesso!';
    const changesSummary: string[] = [];

    if (suggestion.type === 'RARITY' && suggestion.character) {
      const finalRarity = chosenRarity || suggestion.suggestedRarity || 'COMMON';
      if (finalRarity === 'LEGENDARY') {
        const wasMarried = await this.wasCharacterEverMarried(suggestion.character.id);
        if (wasMarried) {
          throw new DomainError(
            'MARRIED_CHARACTER_CANNOT_BE_LEGENDARY',
            `O personagem ${suggestion.character.name} já foi casado e sua raridade máxima permitida é ÉPICO. Para versão Lendária, deve ser criado um novo personagem.`,
            400
          );
        }
      }
      await this.prisma.character.update({
        where: { id: suggestion.character.id },
        data: { baseRarity: finalRarity },
      });
      changesSummary.push(`Raridade alterada de ${suggestion.character.baseRarity} para ${finalRarity}`);
      successMessage = `Raridade de ${suggestion.character.name} alterada para ${finalRarity}!`;
    } else if (suggestion.type === 'EDIT' && suggestion.character) {
      const dataToUpdate: any = {};
      if (suggestion.suggestedName) {
        dataToUpdate.name = suggestion.suggestedName;
        if (suggestion.suggestedName !== suggestion.character.name) {
          changesSummary.push(`Nome atualizado para "${suggestion.suggestedName}"`);
        }
      }
      if (suggestion.suggestedSeries) {
        dataToUpdate.series = suggestion.suggestedSeries;
        if (suggestion.suggestedSeries !== suggestion.character.series) {
          changesSummary.push(`Série atualizada para "${suggestion.suggestedSeries}"`);
        }
      }
      if (suggestion.suggestedGender) {
        dataToUpdate.gender = suggestion.suggestedGender;
        if (suggestion.suggestedGender !== suggestion.character.gender) {
          changesSummary.push(`Gênero atualizado para ${suggestion.suggestedGender}`);
        }
      }
      if (suggestion.suggestedDescription !== null && suggestion.suggestedDescription !== undefined) {
        dataToUpdate.description = suggestion.suggestedDescription;
        changesSummary.push('Biografia/Descrição atualizada');
      }
      if (chosenRarity) {
        dataToUpdate.baseRarity = chosenRarity;
        changesSummary.push(`Raridade alterada para ${chosenRarity}`);
      } else if (suggestion.suggestedRarity) {
        dataToUpdate.baseRarity = suggestion.suggestedRarity;
        changesSummary.push(`Raridade alterada para ${suggestion.suggestedRarity}`);
      }
      if (dataToUpdate.baseRarity === 'LEGENDARY') {
        const wasMarried = await this.wasCharacterEverMarried(suggestion.character.id);
        if (wasMarried) {
          throw new DomainError(
            'MARRIED_CHARACTER_CANNOT_BE_LEGENDARY',
            `O personagem ${suggestion.character.name} já foi casado e sua raridade máxima permitida é ÉPICO. Para versão Lendária, deve ser criado um novo personagem.`,
            400
          );
        }
      }
      if (suggestion.suggestedTags !== undefined && suggestion.suggestedTags !== null) {
        dataToUpdate.tags = suggestion.suggestedTags;
        changesSummary.push(`Tags atualizadas: ${suggestion.suggestedTags.length > 0 ? suggestion.suggestedTags.join(', ') : '(nenhuma)'}`);
      }

      const updated = await this.prisma.character.update({
        where: { id: suggestion.character.id },
        data: dataToUpdate,
      });
      successMessage = `Dados de ${updated.name} atualizados com sucesso!`;
    } else if (suggestion.type === 'IMAGE' && suggestion.character) {
      let actionData: { action?: string; targetPhoto?: string } | null = null;
      if (suggestion.description) {
        try {
          actionData = JSON.parse(suggestion.description);
        } catch (_) {}
      }

      // Moderador pode forçar ação explícita (ADD ou REPLACE); senão respeita a proposta original
      const effectiveAction = overridePhotoAction || actionData?.action || 'ADD';

      if (effectiveAction === 'DELETE' && actionData?.targetPhoto) {
        const target = actionData.targetPhoto;
        const filtered = (suggestion.character.imageUrls || []).filter((img) =>
          img !== target && !img.endsWith(target) && !target.endsWith(img)
        );
        await this.prisma.character.update({
          where: { id: suggestion.character.id },
          data: { imageUrls: filtered },
        });
        changesSummary.push('Foto removida da galeria');
        successMessage = `Foto de ${suggestion.character.name} removida com sucesso!`;
      } else if (effectiveAction === 'REPLACE' && suggestion.imageUrl) {
        const sourcePath = path.resolve(config.MEDIA_DIR, suggestion.imageUrl);
        const uploadsDir = path.resolve(config.MEDIA_DIR, 'uploads', 'characters', suggestion.character.id);
        await fs.mkdir(uploadsDir, { recursive: true });

        const targetFileName = `${Date.now()}_default.png`;
        const targetFilePath = path.join(uploadsDir, targetFileName);

        try {
          await fs.copyFile(sourcePath, targetFilePath);
          const newRelPath = `uploads/characters/${suggestion.character.id}/${targetFileName}`;
          const target = actionData?.targetPhoto || suggestion.character.imageUrls[0];
          const currentList = [...(suggestion.character.imageUrls || [])];
          let idx = -1;
          if (target) {
            idx = currentList.findIndex((img) =>
              img === target || img.endsWith(target) || target.endsWith(img)
            );
          }
          if (idx === -1 && currentList.length > 0) {
            idx = 0; // Substitui a primeira foto se alvo não foi localizado ou não especificado
          }

          if (idx !== -1) {
            currentList[idx] = newRelPath;
          } else {
            currentList.unshift(newRelPath);
          }

          await this.prisma.character.update({
            where: { id: suggestion.character.id },
            data: { imageUrls: currentList },
          });
          changesSummary.push('Foto principal da galeria substituída');
          successMessage = `Foto de ${suggestion.character.name} substituída com sucesso!`;
        } catch (err: any) {
          throw new DomainError('IMAGE_APPLY_FAILED', `Falha ao processar substituição de imagem: ${err.message}`, 500);
        }
      } else if (suggestion.imageUrl) {
        // ADD normal: adiciona à galeria sem apagar nenhuma foto existente
        const sourcePath = path.resolve(config.MEDIA_DIR, suggestion.imageUrl);
        const uploadsDir = path.resolve(config.MEDIA_DIR, 'uploads', 'characters', suggestion.character.id);
        await fs.mkdir(uploadsDir, { recursive: true });

        const targetFileName = `${Date.now()}_default.png`;
        const targetFilePath = path.join(uploadsDir, targetFileName);

        try {
          await fs.copyFile(sourcePath, targetFilePath);
          const newRelPath = `uploads/characters/${suggestion.character.id}/${targetFileName}`;
          const updatedImageUrls = [newRelPath, ...(suggestion.character.imageUrls || [])];

          await this.prisma.character.update({
            where: { id: suggestion.character.id },
            data: { imageUrls: updatedImageUrls },
          });
        } catch (err: any) {
          throw new DomainError('IMAGE_APPLY_FAILED', `Falha ao mover arquivo de imagem: ${err.message}`, 500);
        }
        changesSummary.push('Nova foto adicionada à galeria');
        successMessage = `Nova foto aplicada a ${suggestion.character.name}!`;
      }
    } else if (suggestion.type === 'NEW_CHARACTER') {
      const charName = suggestion.characterName || 'Personagem Sem Nome';
      const baseSlug = slugify(charName) || `char-${Date.now()}`;
      let targetId = baseSlug;

      // Verifica se id já existe
      const existing = await this.prisma.character.findUnique({ where: { id: targetId } });
      if (existing) {
        const candidateId = `${baseSlug}-legendary`;
        const candidateExists = await this.prisma.character.findUnique({ where: { id: candidateId } });
        targetId = candidateExists
          ? `${baseSlug}-${Math.floor(Math.random() * 9000 + 1000)}`
          : candidateId;
      }

      let officialImages: string[] = [];
      if (suggestion.imageUrl) {
        const sourcePath = path.resolve(config.MEDIA_DIR, suggestion.imageUrl);
        const uploadsDir = path.resolve(config.MEDIA_DIR, 'uploads', 'characters', targetId);
        await fs.mkdir(uploadsDir, { recursive: true });

        const targetFileName = 'default.png';
        const targetFilePath = path.join(uploadsDir, targetFileName);

        try {
          await fs.copyFile(sourcePath, targetFilePath);
          officialImages = [`uploads/characters/${targetId}/${targetFileName}`];
        } catch (_) {}
      }

      const createdChar = await this.prisma.character.create({
        data: {
          id: targetId,
          name: charName,
          series: suggestion.series || 'Indefinida',
          gender: suggestion.suggestedGender || 'FEMALE',
          tags: suggestion.suggestedTags || [],
          description: suggestion.description || null,
          baseRarity: suggestion.suggestedRarity || 'COMMON',
          imageUrls: officialImages,
          isActive: true,
        },
      });

      // Se o usuário que sugeriu tiver espaço na wishlist, adiciona automaticamente
      if (suggestion.userId) {
        const currentCount = await this.prisma.wishlistEntry.count({
          where: { userId: suggestion.userId },
        });
        if (currentCount < config.WISHLIST_MAX_ITEMS) {
          await this.prisma.wishlistEntry.create({
            data: {
              userId: suggestion.userId,
              characterId: createdChar.id,
            },
          });
        }
      }

      // Vincula a sugestão ao id criado
      await this.prisma.characterSuggestion.update({
        where: { id: suggestion.id },
        data: { characterId: createdChar.id },
      });

      successMessage = `Personagem ${createdChar.name} criado e adicionado ao catálogo com sucesso!`;
    } else if (suggestion.type === 'DELETE_CHARACTER' && suggestion.characterId) {
      await this.prisma.character.update({
        where: { id: suggestion.characterId },
        data: { isActive: false },
      });
      successMessage = `Personagem desativado/removido do catálogo com sucesso.`;
    }

    // Notifica jogadores casados ou que têm na wishlist se houve alteração em waifu existente
    if (changesSummary.length > 0 && suggestion.character?.id) {
      this.notificationService
        .notifyCharacterModification(suggestion.character.id, changesSummary)
        .catch((err) => console.error('Erro ao notificar alteração de waifu:', err));

      this.characterService.updateCharacterScore(suggestion.character.id).catch(() => {});
    }

    // Notifica o autor da sugestão
    if (suggestion.userId) {
      const charName = suggestion.character?.name || suggestion.characterName || 'Personagem';
      this.notificationService
        .notifySuggestionReview(suggestion.userId, charName, 'APPROVED', suggestion.type)
        .catch((err) => console.error('Erro ao notificar autor da sugestão:', err));
    }

    const updated = await this.prisma.characterSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedBy: chosenRarity && chosenRarity !== suggestion.suggestedRarity
          ? `${reviewedBy} (${chosenRarity})`
          : reviewedBy,
        ...(chosenRarity ? { suggestedRarity: chosenRarity } : {}),
      },
    });

    // Invalida cache de personagens no Redis
    await this.invalidateCharacterCaches();

    return {
      success: true,
      data: {
        message: successMessage,
        suggestion: updated,
      },
    };
  }

  /**
   * Rejeita uma sugestão com motivo opcional
   */
  async rejectSuggestion(suggestionId: string, rejectionReason?: string, reviewedBy = 'admin') {
    const suggestion = await this.prisma.characterSuggestion.findUnique({
      where: { id: suggestionId },
    });

    if (!suggestion) {
      throw new DomainError('SUGGESTION_NOT_FOUND', 'Sugestão não encontrada.', 404);
    }

    if (suggestion.status !== 'PENDING') {
      throw new DomainError('SUGGESTION_ALREADY_REVIEWED', `Esta sugestão já foi avaliada anteriormente (${suggestion.status}).`, 400);
    }

    const updated = await this.prisma.characterSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: 'REJECTED',
        rejectionReason: rejectionReason ? rejectionReason.trim() : null,
        reviewedAt: new Date(),
        reviewedBy,
      },
    });

    // Notifica o autor da sugestão sobre a rejeição
    if (suggestion.userId) {
      const charName = suggestion.characterName || 'Personagem';
      this.notificationService
        .notifySuggestionReview(suggestion.userId, charName, 'REJECTED', suggestion.type, rejectionReason)
        .catch((err) => console.error('Erro ao notificar rejeição de sugestão:', err));
    }

    return {
      success: true,
      data: {
        message: 'Sugestão rejeitada.',
        suggestion: updated,
      },
    };
  }

  /**
   * Aceita e aplica todas as sugestões pendentes de uma vez
   */
  async approveAllSuggestions(reviewedBy = 'admin') {
    const pendings = await this.prisma.characterSuggestion.findMany({
      where: { status: 'PENDING' },
      select: { id: true },
    });

    const results: any[] = [];
    for (const p of pendings) {
      try {
        const res = await this.approveSuggestion(p.id, reviewedBy);
        results.push({ id: p.id, success: true, message: res.data?.message });
      } catch (err: any) {
        results.push({ id: p.id, success: false, error: err.message });
      }
    }

    await this.invalidateCharacterCaches();

    return {
      success: true,
      data: {
        total: pendings.length,
        approvedCount: results.filter((r) => r.success).length,
        results,
      },
    };
  }

  /**
   * Apaga a notificação enviada ao Telegram de uma sugestão
   */
  async deleteTelegramNotification(suggestionId: string): Promise<boolean> {
    return this.telegramService.deleteSuggestionMessage(suggestionId, this.redis);
  }

  /**
   * Deleta uma sugestão e remove sua mensagem do Telegram
   */
  async deleteSuggestion(suggestionId: string) {
    await this.deleteTelegramNotification(suggestionId).catch(() => {});
    return this.prisma.characterSuggestion.delete({
      where: { id: suggestionId },
    });
  }

  /**
   * Apaga a notificação enviada ao Telegram de uma denúncia de múltiplos rolls
   */
  async deleteMultiReportTelegramNotification(reportId: string): Promise<boolean> {
    return this.telegramService.deleteMultiReportMessage(reportId, this.redis);
  }

  /**
   * Submete denúncia de múltiplos personagens (rolls múltiplos) e notifica o Telegram
   */
  async submitMultiRollReport(data: {
    slots: Array<{
      slot: number;
      characterId?: string | null;
      characterName?: string | null;
      series?: string | null;
      rarity?: string | null;
      imageUrl?: string | null;
    }>;
    gridImageBase64?: string | null;
    reason?: string | null;
    userId?: string | null;
    userName?: string | null;
    source?: string | null;
  }) {
    const slotsKey = (data.slots || []).map((s) => `${s.slot}:${s.characterId || ''}`).join(',');
    const fingerprint = createHash('sha256')
      .update(`multireport:${data.userId || 'anon'}:${slotsKey}:${(data.reason || '').trim()}`)
      .digest('hex');

    return this.executeWithDebounce(fingerprint, async () => {
      const reportId = randomUUID().replace(/-/g, '').slice(0, 12);

      await this.telegramService.notifyMultiRollReport({
        id: reportId,
        slots: (data.slots || []).map((s) => ({
          slot: s.slot,
          characterId: s.characterId || null,
          characterName: s.characterName || null,
          series: s.series || null,
          rarity: s.rarity || 'COMMON',
          imageUrl: s.imageUrl || null,
          removed: false,
        })),
        gridImageBase64: data.gridImageBase64,
        reason: data.reason,
        userId: data.userId,
        userName: data.userName,
        source: data.source,
      });

      return { id: reportId, slotsCount: (data.slots || []).length };
    });
  }

  /**
   * Desativa um personagem do catálogo a partir de uma moderação via Telegram
   */
  async deactivateCharacter(characterId: string, reason = 'Denúncia', moderatorName = 'moderator') {
    const cleanId = String(characterId).trim();
    const character = await this.prisma.character.findFirst({
      where: {
        OR: [
          { id: cleanId },
          { id: cleanId.toLowerCase() },
          { name: { equals: cleanId, mode: 'insensitive' } },
        ],
      },
    });
    if (!character) return null;

    await this.prisma.character.update({
      where: { id: character.id },
      data: { isActive: false },
    });

    await this.prisma.characterSuggestion.create({
      data: {
        characterId: character.id,
        type: 'DELETE_CHARACTER',
        status: 'APPROVED',
        reason,
        reviewedBy: moderatorName,
        reviewedAt: new Date(),
      },
    }).catch(() => {});

    await this.invalidateCharacterCaches();
    return character;
  }

  /**
   * Invalida as chaves de cache de personagens no Redis
   */
  private async invalidateCharacterCaches() {
    try {
      const keys = await this.redis.keys('cache:characters:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (_) {}
  }

  /**
   * Executa uma ação com debounce em nível de Redis baseado em um fingerprint dos dados.
   * Se uma solicitação idêntica for enviada concorrentemente ou dentro da janela de TTL,
   * retorna o resultado já existente sem duplicar registros no banco ou notificações no Telegram.
   */
  private async executeWithDebounce<T>(
    fingerprint: string,
    action: () => Promise<T>,
    ttlSeconds = 15
  ): Promise<T> {
    const cacheKey = `suggestion:debounce:${fingerprint}`;
    const lockKey = `suggestion:lock:${fingerprint}`;

    // 1. Se já temos o resultado recente em cache, retorna diretamente
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as T;
        }
      } catch (_) {}
    }

    // 2. Tenta adquirir o lock atômico para esta solicitação
    let acquired = false;
    if (this.redis) {
      try {
        const res = await this.redis.set(lockKey, '1', 'EX', 10, 'NX');
        acquired = res === 'OK';
      } catch (_) {
        acquired = true; // Se o Redis falhar, prossegue normalmente
      }
    } else {
      acquired = true;
    }

    if (!acquired && this.redis) {
      // 3. Outra requisição idêntica está em processamento concorrente no mesmo instante.
      // Aguarda até 3 segundos pela conclusão da primeira e retorno do cache.
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        try {
          const cached = await this.redis.get(cacheKey);
          if (cached) {
            return JSON.parse(cached) as T;
          }
        } catch (_) {}
      }
    }

    try {
      const result = await action();
      if (this.redis) {
        try {
          await this.redis.set(cacheKey, JSON.stringify(result), 'EX', ttlSeconds);
        } catch (_) {}
      }
      return result;
    } finally {
      if (acquired && this.redis) {
        try {
          await this.redis.del(lockKey);
        } catch (_) {}
      }
    }
  }

  /**
   * Obtém o parecer da IA salvo para uma sugestão ou avalia sob demanda
   */
  async getOrEvaluateAiAdvisor(suggestionId: string, refresh = false) {
    if (!refresh && this.redis) {
      try {
        const cached = await this.redis.get(`suggestion:ai:${suggestionId}`);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (_) {}
    }

    const suggestion = await this.prisma.characterSuggestion.findUnique({
      where: { id: suggestionId },
      include: {
        character: true,
        user: true,
      },
    });

    if (!suggestion) {
      throw new DomainError('SUGGESTION_NOT_FOUND', 'Sugestão não encontrada.', 404);
    }

    const marriageInfo = suggestion.characterId && suggestion.userId
      ? await this.getCharacterMarriage(suggestion.characterId, suggestion.userId)
      : { marriedUser: null, isMarriedToSuggester: false };

    let actionData: { action?: string; targetPhoto?: string } | null = null;
    if (suggestion.type === 'IMAGE' && suggestion.description) {
      try {
        actionData = JSON.parse(suggestion.description);
      } catch (_) {}
    }

    const notifyData = {
      id: suggestion.id,
      type: suggestion.type,
      characterId: suggestion.characterId,
      characterName: suggestion.character?.name || suggestion.characterName,
      series: suggestion.character?.series || suggestion.series,
      currentRarity: suggestion.currentRarity || suggestion.character?.baseRarity,
      suggestedRarity: suggestion.suggestedRarity,
      suggestedName: suggestion.suggestedName,
      suggestedSeries: suggestion.suggestedSeries,
      suggestedGender: suggestion.suggestedGender,
      suggestedDescription: suggestion.suggestedDescription,
      suggestedTags: suggestion.suggestedTags,
      photoAction: (actionData?.action as any) || (suggestion.type === 'IMAGE' ? 'ADD' : null),
      targetPhoto: actionData?.targetPhoto || null,
      reason: suggestion.reason,
      imageUrl: suggestion.imageUrl,
      userName: suggestion.user?.name || 'Usuário',
      userId: suggestion.userId,
      character: suggestion.character ? {
        id: suggestion.character.id,
        name: suggestion.character.name,
        series: suggestion.character.series,
        baseRarity: suggestion.character.baseRarity,
        gender: suggestion.character.gender,
        description: suggestion.character.description,
        tags: suggestion.character.tags,
        imageUrl: this.characterService.getRandomImageUrl(suggestion.character.id, suggestion.character.imageUrls),
        rank: suggestion.character.rank,
        waifuRank: suggestion.character.waifuRank,
      } : null,
      marriedUser: marriageInfo.marriedUser,
      isMarriedToSuggester: marriageInfo.isMarriedToSuggester,
    };

    const evaluation = await this.rarityAdvisorService.evaluateRaritySuggestion(notifyData, this.redis);
    return evaluation;
  }
}
