import { PrismaClient } from '@prisma/client';
import { CharacterService } from './CharacterService.js';
import { config } from '../config.js';

export class WishlistService {
  constructor(
    private prisma: PrismaClient,
    private characterService: CharacterService
  ) {}

  async getWishlist(userId: string) {
    const entries = await this.prisma.wishlistEntry.findMany({
      where: { userId },
      include: {
        character: {
          include: {
            haremEntries: {
              take: 1,
              include: {
                user: {
                  select: { id: true, name: true, publicId: true },
                },
              },
            },
          },
        },
      },
      orderBy: [{ isStarWish: 'desc' }, { addedAt: 'desc' }],
    });

    return entries.map((entry) => {
      const haremEntry = entry.character.haremEntries?.[0];
      const isMarried = Boolean(haremEntry);
      const marriedTo = haremEntry?.user?.name || null;
      const marriedToPublicId = haremEntry?.user?.publicId || null;

      const { haremEntries, ...charRest } = entry.character;

      return {
        id: entry.id,
        isStarWish: entry.isStarWish,
        addedAt: entry.addedAt,
        isMarried,
        marriedTo,
        marriedToPublicId,
        character: {
          ...charRest,
          imageUrl: this.characterService.getRandomImageUrl(entry.character.id, entry.character.imageUrls),
          imageUrls: entry.character.imageUrls.map((img) => this.characterService.formatImageUrl(entry.character.id, img)),
          isMarried,
          marriedTo,
          marriedToPublicId,
        },
      };
    });
  }

  async clearMarried(userId: string) {
    const marriedEntries = await this.prisma.wishlistEntry.findMany({
      where: {
        userId,
        character: {
          haremEntries: {
            some: {},
          },
        },
      },
      include: {
        character: {
          select: { id: true, name: true },
        },
      },
    });

    if (marriedEntries.length === 0) {
      return {
        success: true,
        data: {
          removedCount: 0,
          removedCharacters: [],
          message: 'Nenhuma personagem casada foi encontrada na sua Wishlist.',
        },
      };
    }

    const idsToDelete = marriedEntries.map((e) => e.id);
    const removedCharacters = marriedEntries.map((e) => e.character.name);

    await this.prisma.wishlistEntry.deleteMany({
      where: {
        id: { in: idsToDelete },
      },
    });

    return {
      success: true,
      data: {
        removedCount: idsToDelete.length,
        removedCharacters,
        message: `${idsToDelete.length} personagem(ns) casada(s) foram removida(s) da sua Wishlist com sucesso!`,
      },
    };
  }

  async addToWishlist(userId: string, characterId: string, isStarWish = false) {
    // 1. Verificar se o personagem existe (busca flexível)
    const character = await this.characterService.findCharacter(characterId);

    if (!character) {
      return {
        success: false,
        error: { code: 'CHARACTER_NOT_FOUND', message: 'Personagem não encontrado.' },
      };
    }

    // 2. Verificar limite máximo da wishlist
    const currentCount = await this.prisma.wishlistEntry.count({
      where: { userId },
    });

    if (currentCount >= config.WISHLIST_MAX_ITEMS) {
      return {
        success: false,
        error: {
          code: 'WISHLIST_LIMIT_REACHED',
          message: `Você atingiu o limite de ${config.WISHLIST_MAX_ITEMS} desejos na sua wishlist. Remova algum para adicionar novos.`,
        },
      };
    }

    // 3. Upsert
    const entry = await this.prisma.wishlistEntry.upsert({
      where: {
        userId_characterId: {
          userId,
          characterId: character.id,
        },
      },
      create: {
        userId,
        characterId: character.id,
        isStarWish,
      },
      update: {
        isStarWish,
      },
    });

    return {
      success: true,
      data: {
        message: `${character.name} foi adicionada(o) à sua Wishlist! ${isStarWish ? '⭐ (Starwish)' : '💖'}`,
        entry,
      },
    };
  }

  async removeFromWishlist(userId: string, characterId: string) {
    const character = await this.characterService.findCharacter(characterId);
    const targetId = character ? character.id : characterId;

    const existing = await this.prisma.wishlistEntry.findFirst({
      where: {
        userId,
        OR: [
          { characterId: targetId },
          { characterId: characterId },
        ],
      },
    });

    if (!existing) {
      return {
        success: false,
        error: {
          code: 'ENTRY_NOT_FOUND',
          message: 'Este personagem não está na sua wishlist.',
        },
      };
    }

    await this.prisma.wishlistEntry.delete({
      where: { id: existing.id },
    });

    return {
      success: true,
      data: {
        message: 'Personagem removido da wishlist com sucesso.',
      },
    };
  }
}
