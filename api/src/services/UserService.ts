import { PrismaClient, Platform } from '@prisma/client';
import { Redis } from 'ioredis';

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
          take: 1,
          include: {
            character: true,
          },
        },
      },
    });

    if (!user) return null;

    const favoriteCharacter = user.harem[0]?.character ?? null;

    return {
      id: user.id,
      name: user.name,
      platform: user.platform,
      kakera: user.kakera,
      haremCount: user._count.harem,
      soulmateCount: user._count.soulmates,
      wishlistCount: user._count.wishlist,
      favoriteCharacter,
      createdAt: user.createdAt,
    };
  }

  async setFavoriteCharacter(userId: string, characterId: string) {
    // 1. Desmarca favorito atual
    await this.prisma.haremEntry.updateMany({
      where: { userId, isFavorite: true },
      data: { isFavorite: false },
    });

    // 2. Marca novo favorito
    const updated = await this.prisma.haremEntry.update({
      where: {
        userId_characterId: {
          userId,
          characterId,
        },
      },
      data: { isFavorite: true },
      include: { character: true },
    });

    return updated;
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
