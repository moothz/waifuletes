import { PrismaClient, SuggestionType, SuggestionStatus, Rarity } from '@prisma/client';
import { Redis } from 'ioredis';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { DomainError } from '../errors/DomainError.js';
import { CharacterService, slugify } from './CharacterService.js';
import { TelegramNotificationService } from './TelegramNotificationService.js';

export class SuggestionService {
  private telegramService: TelegramNotificationService;

  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private characterService: CharacterService
  ) {
    this.telegramService = new TelegramNotificationService();
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

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    const suggestion = await this.prisma.characterSuggestion.create({
      data: {
        characterId: character.id,
        userId,
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

    // Notifica Telegram
    this.telegramService.notifySuggestion({
      id: suggestion.id,
      type: 'RARITY',
      characterId: character.id,
      currentRarity: character.baseRarity,
      suggestedRarity,
      reason: reason.trim(),
      userName: user?.name || userId,
      character: {
        id: character.id,
        name: character.name,
        series: character.series,
        baseRarity: character.baseRarity,
        imageUrl: this.characterService.getRandomImageUrl(character.id, character.imageUrls),
      },
    }).catch((err) => console.error('Telegram notification error:', err));

    return suggestion;
  }

  /**
   * Envia uma sugestão de nova foto (já recortada pelo cliente)
   */
  async submitImageSuggestion(userId: string, characterId: string, imageBuffer: Buffer, reason?: string) {
    const character = await this.characterService.findCharacter(characterId);
    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.', 404);
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      throw new DomainError('IMAGE_REQUIRED', 'Buffer de imagem não fornecido ou vazio.', 400);
    }

    const suggestionId = randomUUID();
    const fileName = `${suggestionId}.png`;
    const suggestionsDir = path.resolve(config.MEDIA_DIR, 'suggestions');

    await fs.mkdir(suggestionsDir, { recursive: true });
    const filePath = path.join(suggestionsDir, fileName);
    await fs.writeFile(filePath, imageBuffer);

    const relPath = `suggestions/${fileName}`;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    const suggestion = await this.prisma.characterSuggestion.create({
      data: {
        id: suggestionId,
        characterId: character.id,
        userId,
        type: 'IMAGE',
        status: 'PENDING',
        imageUrl: relPath,
        reason: reason ? reason.trim() : null,
      },
      include: {
        character: {
          select: { id: true, name: true, series: true, baseRarity: true, imageUrls: true },
        },
      },
    });

    // Notifica Telegram
    this.telegramService.notifySuggestion({
      id: suggestion.id,
      type: 'IMAGE',
      characterId: character.id,
      imageUrl: relPath,
      reason: reason ? reason.trim() : null,
      userName: user?.name || userId,
      character: {
        id: character.id,
        name: character.name,
        series: character.series,
        baseRarity: character.baseRarity,
        imageUrl: this.characterService.getRandomImageUrl(character.id, character.imageUrls),
      },
    }).catch((err) => console.error('Telegram notification error:', err));

    return suggestion;
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
      description?: string;
      reason?: string;
      imageBuffer?: Buffer;
    }
  ) {
    if (!data.name || data.name.trim().length < 2) {
      throw new DomainError('INVALID_NAME', 'O nome do personagem deve conter ao menos 2 caracteres.', 400);
    }

    if (!data.series || data.series.trim().length < 2) {
      throw new DomainError('INVALID_SERIES', 'A série/origem deve conter ao menos 2 caracteres.', 400);
    }

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

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    const suggestion = await this.prisma.characterSuggestion.create({
      data: {
        id: suggestionId,
        userId,
        type: 'NEW_CHARACTER',
        status: 'PENDING',
        characterName: data.name.trim(),
        series: data.series.trim(),
        description: data.description ? data.description.trim() : null,
        suggestedRarity: data.rarity || 'COMMON',
        imageUrl: relPath,
        reason: data.reason ? data.reason.trim() : null,
      },
    });

    // Notifica Telegram
    this.telegramService.notifySuggestion({
      id: suggestion.id,
      type: 'NEW_CHARACTER',
      characterName: data.name.trim(),
      series: data.series.trim(),
      description: data.description ? data.description.trim() : null,
      suggestedRarity: data.rarity || 'COMMON',
      imageUrl: relPath,
      reason: data.reason ? data.reason.trim() : null,
      userName: user?.name || userId,
    }).catch((err) => console.error('Telegram notification error:', err));

    return suggestion;
  }

  /**
   * Envia uma denúncia de exclusão para um personagem (botão 🔞 na home)
   */
  async submitDeleteSuggestion(characterId: string, userId?: string, reason?: string) {
    const character = await this.characterService.findCharacter(characterId);
    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.', 404);
    }

    let userName = 'Anônimo na Home';
    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      if (user?.name) userName = user.name;
    }

    const suggestion = await this.prisma.characterSuggestion.create({
      data: {
        characterId: character.id,
        userId: userId || null,
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

    // Notifica Telegram
    this.telegramService.notifySuggestion({
      id: suggestion.id,
      type: 'DELETE_CHARACTER',
      characterId: character.id,
      reason: reason ? reason.trim() : 'Conteúdo inadequado ou denúncia de exclusão (🔞).',
      userName,
      character: {
        id: character.id,
        name: character.name,
        series: character.series,
        baseRarity: character.baseRarity,
        imageUrl: this.characterService.getRandomImageUrl(character.id, character.imageUrls),
      },
    }).catch((err) => console.error('Telegram notification error:', err));

    return suggestion;
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
            select: { id: true, name: true, series: true, baseRarity: true, imageUrls: true },
          },
          user: {
            select: { publicId: true, name: true },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: suggestions.map((s) => ({
        id: s.id,
        characterId: s.characterId,
        type: s.type,
        status: s.status,
        characterName: s.characterName,
        series: s.series,
        description: s.description,
        currentRarity: s.currentRarity,
        suggestedRarity: s.suggestedRarity,
        reason: s.reason,
        imageUrl: s.imageUrl ? `${config.PUBLIC_BASE_URL}/media/${s.imageUrl}` : null,
        rawImageUrl: s.imageUrl,
        reviewedAt: s.reviewedAt,
        reviewedBy: s.reviewedBy,
        rejectionReason: s.rejectionReason,
        createdAt: s.createdAt,
        character: s.character
          ? {
              ...s.character,
              imageUrl: this.characterService.getRandomImageUrl(s.character.id, s.character.imageUrls),
            }
          : null,
        user: s.user
          ? {
              name: s.user.name,
              publicId: s.user.publicId,
            }
          : null,
      })),
    };
  }

  /**
   * Lista sugestões de um usuário específico
   */
  async listUserSuggestions(userId: string) {
    const suggestions = await this.prisma.characterSuggestion.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        character: {
          select: { id: true, name: true, series: true, baseRarity: true, imageUrls: true },
        },
      },
    });

    return suggestions.map((s) => ({
      id: s.id,
      characterId: s.characterId,
      type: s.type,
      status: s.status,
      characterName: s.characterName,
      series: s.series,
      description: s.description,
      currentRarity: s.currentRarity,
      suggestedRarity: s.suggestedRarity,
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
          }
        : null,
    }));
  }

  /**
   * Aceita uma sugestão e aplica a alteração automaticamente
   */
  async approveSuggestion(suggestionId: string, reviewedBy = 'admin') {
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

    let successMessage = 'Sugestão aprovada e aplicada com sucesso!';

    if (suggestion.type === 'RARITY' && suggestion.character && suggestion.suggestedRarity) {
      await this.prisma.character.update({
        where: { id: suggestion.character.id },
        data: { baseRarity: suggestion.suggestedRarity },
      });
      successMessage = `Raridade de ${suggestion.character.name} alterada para ${suggestion.suggestedRarity}!`;
    } else if (suggestion.type === 'IMAGE' && suggestion.character && suggestion.imageUrl) {
      const sourcePath = path.resolve(config.MEDIA_DIR, suggestion.imageUrl);
      const uploadsDir = path.resolve(config.MEDIA_DIR, 'uploads', 'characters', suggestion.character.id);
      await fs.mkdir(uploadsDir, { recursive: true });

      const targetFileName = `${Date.now()}_default.png`;
      const targetFilePath = path.join(uploadsDir, targetFileName);

      try {
        await fs.copyFile(sourcePath, targetFilePath);
        const newRelPath = `uploads/characters/${suggestion.character.id}/${targetFileName}`;
        const updatedImageUrls = [newRelPath, ...suggestion.character.imageUrls];

        await this.prisma.character.update({
          where: { id: suggestion.character.id },
          data: { imageUrls: updatedImageUrls },
        });
      } catch (err: any) {
        throw new DomainError('IMAGE_APPLY_FAILED', `Falha ao mover arquivo de imagem: ${err.message}`, 500);
      }
      successMessage = `Nova foto aplicada a ${suggestion.character.name}!`;
    } else if (suggestion.type === 'NEW_CHARACTER') {
      const charName = suggestion.characterName || 'Personagem Sem Nome';
      const baseSlug = slugify(charName) || `char-${Date.now()}`;
      let targetId = baseSlug;

      // Verifica se id já existe
      const existing = await this.prisma.character.findUnique({ where: { id: targetId } });
      if (existing) {
        targetId = `${baseSlug}-${Math.floor(Math.random() * 9000 + 1000)}`;
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

    const updated = await this.prisma.characterSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedBy,
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
}
