import { PrismaClient, Platform } from '@prisma/client';
import { Redis } from 'ioredis';
import { config } from '../config.js';

export interface EnsureUserParams {
  userId: string;
  groupId: string;
  name?: string;
  platform?: Platform;
}

export class UserService {
  constructor(
    private prisma: PrismaClient,
    private redis?: Redis
  ) {}

  async ensureUserAndGroup(params: EnsureUserParams) {
    const { userId, groupId, name, platform = 'WHATSAPP' } = params;

    // Cache no Redis para evitar escritas repetidas no banco em rolls frequentes
    if (this.redis) {
      const cacheKey = `seen:${userId}:${groupId}`;
      const seen = await this.redis.get(cacheKey);
      if (seen && (!name || seen === name)) {
        return { cached: true };
      }
    }

    try {
      // 1. Upsert User
      const user = await this.prisma.user.upsert({
        where: { id: userId },
        create: {
          id: userId,
          name: name || userId,
          platform,
        },
        update: {
          ...(name ? { name } : {}),
        },
      });

      // 2. Upsert Group
      const group = await this.prisma.group.upsert({
        where: { id: groupId },
        create: {
          id: groupId,
          name: groupId === userId ? 'Privado' : `Grupo ${groupId}`,
          platform,
        },
        update: {},
      });

      // 3. Upsert UserGroup relationship
      await this.prisma.userGroup.upsert({
        where: {
          userId_groupId: {
            userId,
            groupId,
          },
        },
        create: {
          userId,
          groupId,
        },
        update: {},
      });

      if (this.redis) {
        await this.redis.set(`seen:${userId}:${groupId}`, name || '1', 'EX', 3600);
      }

      return { user, group };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Concorrência no primeiro insert: outra requisição paralela já realizou o cadastro
        if (this.redis) {
          await this.redis.set(`seen:${userId}:${groupId}`, name || '1', 'EX', 3600);
        }
        return { cached: true };
      }
      throw err;
    }
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            harem: true,
            soulmates: true,
            wishlist: true,
          },
        },
        harem: {
          where: { isFavorite: true },
          take: 5,
          include: {
            character: true,
          },
        },
      },
    });

    if (!user) return null;

    const favoriteCharacters = user.harem.map((h) => h.character);
    const favoriteCharacter = favoriteCharacters[0] ?? null;

    return {
      id: user.id,
      publicId: user.publicId,
      publicUrl: `${config.PUBLIC_BASE_URL}/user/${user.publicId}`,
      name: user.name,
      platform: user.platform,
      kakera: user.kakera,
      haremCount: user._count.harem,
      soulmateCount: user._count.soulmates,
      wishlistCount: user._count.wishlist,
      favoriteCharacter,
      favoriteCharacters,
      createdAt: user.createdAt,
    };
  }

  async setFavoriteCharacter(userId: string, characterId: string) {
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
      throw new Error('NOT_IN_HAREM');
    }

    if (entry.isFavorite) {
      return this.prisma.haremEntry.update({
        where: { id: entry.id },
        data: { isFavorite: false },
        include: { character: true },
      });
    }

    const currentCount = await this.prisma.haremEntry.count({
      where: { userId, isFavorite: true },
    });

    if (currentCount >= 5) {
      throw new Error('FAVORITES_LIMIT_REACHED');
    }

    return this.prisma.haremEntry.update({
      where: { id: entry.id },
      data: { isFavorite: true },
      include: { character: true },
    });
  }

  async updateUserName(userId: string, name: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { name },
    });
  }

  async getUserGroups(userId: string) {
    return this.prisma.userGroup.findMany({
      where: { userId },
      include: {
        group: true,
      },
      orderBy: { joinedAt: 'desc' },
    });
  }
}
