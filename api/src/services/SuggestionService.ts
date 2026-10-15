import { PrismaClient, SuggestionType, SuggestionStatus, Rarity } from '@prisma/client';
import { Redis } from 'ioredis';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { DomainError } from '../errors/DomainError.js';
import { CharacterService } from './CharacterService.js';

export class SuggestionService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private characterService: CharacterService
  ) {}

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
          select: { id: true, name: true, series: true, baseRarity: true },
        },
      },
    });

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
          select: { id: true, name: true, series: true, baseRarity: true },
        },
      },
    });

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
        currentRarity: s.currentRarity,
        suggestedRarity: s.suggestedRarity,
        reason: s.reason,
        imageUrl: s.imageUrl ? `${config.PUBLIC_BASE_URL}/media/${s.imageUrl}` : null,
        rawImageUrl: s.imageUrl,
        reviewedAt: s.reviewedAt,
        reviewedBy: s.reviewedBy,
        rejectionReason: s.rejectionReason,
        createdAt: s.createdAt,
        character: {
          ...s.character,
          imageUrl: this.characterService.getRandomImageUrl(s.character.id, s.character.imageUrls),
        },
        user: {
          name: s.user.name,
          publicId: s.user.publicId,
        },
      })),
    };
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

    const character = suggestion.character;

    if (suggestion.type === 'RARITY' && suggestion.suggestedRarity) {
      await this.prisma.character.update({
        where: { id: character.id },
        data: { baseRarity: suggestion.suggestedRarity },
      });
    } else if (suggestion.type === 'IMAGE' && suggestion.imageUrl) {
      // Salva a imagem recortada na pasta oficial de uploads
      const sourcePath = path.resolve(config.MEDIA_DIR, suggestion.imageUrl);
      const uploadsDir = path.resolve(config.MEDIA_DIR, 'uploads', 'characters', character.id);
      await fs.mkdir(uploadsDir, { recursive: true });

      const targetFileName = `${Date.now()}_default.png`;
      const targetFilePath = path.join(uploadsDir, targetFileName);

      try {
        await fs.copyFile(sourcePath, targetFilePath);
        const newRelPath = `uploads/characters/${character.id}/${targetFileName}`;
        const updatedImageUrls = [newRelPath, ...character.imageUrls];

        await this.prisma.character.update({
          where: { id: character.id },
          data: { imageUrls: updatedImageUrls },
        });
      } catch (err: any) {
        throw new DomainError('IMAGE_APPLY_FAILED', `Falha ao mover arquivo de imagem: ${err.message}`, 500);
      }
    }

    const updated = await this.prisma.characterSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedBy,
      },
    });

    // Invalida cache de listagem de personagens no Redis
    await this.invalidateCharacterCaches();

    return {
      success: true,
      data: {
        message: `Sugestão aprovada e modificação aplicada com sucesso ao personagem ${character.name}!`,
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
