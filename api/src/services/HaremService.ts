import { PrismaClient } from '@prisma/client';
import { CharacterService } from './CharacterService.js';

export class HaremService {
  constructor(
    private prisma: PrismaClient,
    private characterService: CharacterService
  ) {}

  async getUserHarem(userId: string, page = 1, limit = 20, sort: 'keys' | 'date' | 'rarity' = 'keys') {
    const skip = (page - 1) * limit;

    let orderBy: any = [{ isFavorite: 'desc' }, { keys: 'desc' }, { character: { baseRarity: 'desc' } }, { character: { claimCount: 'desc' } }];

    if (sort === 'date') {
      orderBy = [{ isFavorite: 'desc' }, { claimedAt: 'desc' }];
    } else if (sort === 'rarity') {
      orderBy = [{ isFavorite: 'desc' }, { character: { baseRarity: 'desc' } }, { keys: 'desc' }];
    }

    const [total, entries] = await Promise.all([
      this.prisma.haremEntry.count({ where: { userId } }),
      this.prisma.haremEntry.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy,
        include: {
          character: true,
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: entries.map((e) => ({
        id: e.id,
        claimedAt: e.claimedAt,
        claimedInGroup: e.claimedInGroup,
        keys: e.keys,
        isFavorite: e.isFavorite,
        note: e.note,
        character: {
          ...e.character,
          imageUrl: this.characterService.getRandomImageUrl(e.character.id, e.character.imageUrls),
          imageUrls: e.character.imageUrls.map((img) => this.characterService.formatImageUrl(e.character.id, img)),
        },
      })),
    };
  }

  async setFavorite(userId: string, characterId: string) {
    const entry = await this.prisma.haremEntry.findUnique({
      where: {
        userId_characterId: {
          userId,
          characterId,
        },
      },
      include: { character: true },
    });

    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_IN_HAREM', message: 'Personagem não encontrado no seu harém.' },
      };
    }

    // Se já é favorita, desmarca (toggle)
    if (entry.isFavorite) {
      await this.prisma.haremEntry.update({
        where: { id: entry.id },
        data: { isFavorite: false },
      });

      return {
        success: true,
        data: {
          isFavorite: false,
          message: `${entry.character.name} foi removida das suas favoritas em destaque. 💔`,
        },
      };
    }

    // Se não é favorita, verifica o limite de 5 favoritas
    const currentFavoritesCount = await this.prisma.haremEntry.count({
      where: { userId, isFavorite: true },
    });

    if (currentFavoritesCount >= 5) {
      return {
        success: false,
        error: {
          code: 'FAVORITES_LIMIT_REACHED',
          message: 'Você já possui o limite máximo de 5 waifus favoritas em destaque. Remova uma antes para adicionar outra.',
        },
      };
    }

    await this.prisma.haremEntry.update({
      where: { id: entry.id },
      data: { isFavorite: true },
    });

    return {
      success: true,
      data: {
        isFavorite: true,
        favoritesCount: currentFavoritesCount + 1,
        message: `${entry.character.name} agora é sua favorita em destaque! 💖 (${currentFavoritesCount + 1}/5)`,
      },
    };
  }

  async setNote(userId: string, characterId: string, note: string) {
    const entry = await this.prisma.haremEntry.findUnique({
      where: {
        userId_characterId: {
          userId,
          characterId,
        },
      },
    });

    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_IN_HAREM', message: 'Personagem não encontrado no seu harém.' },
      };
    }

    const updated = await this.prisma.haremEntry.update({
      where: { id: entry.id },
      data: { note },
    });

    return {
      success: true,
      data: updated,
    };
  }

  async getSoulmates(userId: string) {
    const soulmates = await this.prisma.soulmate.findMany({
      where: { userId },
      include: {
        character: true,
      },
      orderBy: { becameSoulmateAt: 'desc' },
    });

    return soulmates.map((s) => ({
      id: s.id,
      becameSoulmateAt: s.becameSoulmateAt,
      alias: s.alias,
      note: s.note,
      character: {
        ...s.character,
        imageUrl: this.characterService.getRandomImageUrl(s.character.id, s.character.imageUrls),
        imageUrls: s.character.imageUrls.map((img) => this.characterService.formatImageUrl(s.character.id, img)),
      },
    }));
  }

  async updateSoulmate(userId: string, characterId: string, alias?: string, note?: string) {
    const existing = await this.prisma.soulmate.findUnique({
      where: {
        userId_characterId: {
          userId,
          characterId,
        },
      },
    });

    if (!existing) {
      return {
        success: false,
        error: { code: 'NOT_SOULMATE', message: 'Este personagem não é seu Soulmate.' },
      };
    }

    const updated = await this.prisma.soulmate.update({
      where: { id: existing.id },
      data: {
        ...(alias !== undefined ? { alias } : {}),
        ...(note !== undefined ? { note } : {}),
      },
    });

    return {
      success: true,
      data: updated,
    };
  }
}
