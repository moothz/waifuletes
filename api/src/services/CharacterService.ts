import { PrismaClient, Rarity, Gender } from '@prisma/client';
import { Redis } from 'ioredis';
import { ManifestCharacter } from '../utils/manifestLoader.js';
import { RARITY_BASE_WEIGHTS } from '../utils/rarityCalculator.js';
import { config } from '../config.js';

export interface CharacterFilter {
  series?: string;
  rarity?: Rarity;
  gender?: Gender;
  tag?: string;
  search?: string;
  page?: number;
  limit?: number;
  maritalStatus?: 'all' | 'single' | 'married' | string;
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class CharacterService {
  constructor(
    private prisma: PrismaClient,
    private redis?: Redis
  ) {}

  formatImageUrl(characterId: string, imagePath?: string): string {
    if (!imagePath) {
      return `${config.PUBLIC_BASE_URL}/media/characters/${characterId}/default.jpg`;
    }
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      return imagePath;
    }
    return `${config.PUBLIC_BASE_URL}/media/${imagePath}`;
  }

  getRandomImageUrl(characterId: string, imageUrls?: string[]): string {
    if (!imageUrls || imageUrls.length === 0) {
      return this.formatImageUrl(characterId);
    }
    const randomIndex = Math.floor(Math.random() * imageUrls.length);
    return this.formatImageUrl(characterId, imageUrls[randomIndex]);
  }

  async findCharacter(identifier: string) {
    const trimmed = identifier.trim();
    const slug = slugify(trimmed);

    return this.prisma.character.findFirst({
      where: {
        OR: [
          { id: trimmed },
          { id: slug },
          { name: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
    });
  }

  async listCharacters(filter: CharacterFilter, isTrusted = true) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = {
      isActive: true,
    };

    if (filter.series) {
      where.series = { contains: filter.series, mode: 'insensitive' };
    }
    if (filter.rarity) {
      where.baseRarity = filter.rarity;
    }
    if (filter.gender) {
      where.gender = filter.gender;
    }
    if (filter.tag) {
      where.tags = { has: filter.tag };
    }
    if (filter.search) {
      where.OR = [
        { id: { contains: filter.search, mode: 'insensitive' } },
        { name: { contains: filter.search, mode: 'insensitive' } },
        { series: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    if (filter.maritalStatus === 'married') {
      where.haremEntries = { some: {} };
    } else if (filter.maritalStatus === 'single') {
      where.haremEntries = { none: {} };
    }

    const [total, characters] = await Promise.all([
      this.prisma.character.count({ where }),
      this.prisma.character.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              wishlists: true,
            },
          },
          haremEntries: {
            take: 1,
            include: {
              user: {
                select: { id: true, name: true, platform: true },
              },
            },
          },
        },
        orderBy: [{ claimCount: 'desc' }, { likeCount: 'desc' }, { name: 'asc' }],
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: characters.map((c: any) => {
        const rawOwner = c.haremEntries?.[0]?.user ?? null;
        let owner: any = null;
        if (rawOwner) {
          owner = isTrusted
            ? rawOwner
            : { name: rawOwner.name };
        }

        const { haremEntries, ...charRest } = c;

        return {
          ...charRest,
          imageUrl: this.getRandomImageUrl(c.id, c.imageUrls),
          imageUrls: c.imageUrls.map((img: string) => this.formatImageUrl(c.id, img)),
          isClaimed: !!rawOwner,
          owner,
          claimedInGroup: isTrusted ? (c.haremEntries?.[0]?.claimedInGroup ?? null) : null,
          wishlistCount: c._count?.wishlists ?? 0,
        };
      }),
    };
  }

  async getCharacterById(characterId: string, isTrusted = true) {
    const trimmed = characterId.trim();
    const slug = slugify(trimmed);

    const character = await this.prisma.character.findFirst({
      where: {
        OR: [
          { id: trimmed },
          { id: slug },
          { name: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
      include: {
        haremEntries: {
          include: {
            user: {
              select: { id: true, name: true, platform: true },
            },
          },
        },
        _count: {
          select: {
            haremEntries: true,
            wishlists: true,
            soulmates: true,
          },
        },
      },
    });

    if (!character) return null;

    const rawOwner = character.haremEntries[0]?.user ?? null;
    let owner: any = null;
    if (rawOwner) {
      owner = isTrusted
        ? rawOwner
        : { name: rawOwner.name };
    }

    const { haremEntries, ...charRest } = character;

    return {
      ...charRest,
      imageUrl: this.getRandomImageUrl(character.id, character.imageUrls),
      imageUrls: character.imageUrls.map((img) => this.formatImageUrl(character.id, img)),
      isClaimed: !!rawOwner,
      owner,
      claimedInGroup: isTrusted ? (character.haremEntries[0]?.claimedInGroup ?? null) : null,
    };
  }

  async likeCharacter(userId: string, characterId: string) {
    const character = await this.findCharacter(characterId);

    if (!character) {
      throw new Error('CHARACTER_NOT_FOUND');
    }

    const updated = await this.prisma.character.update({
      where: { id: character.id },
      data: {
        likeCount: { increment: 1 },
      },
    });

    return updated;
  }

  async toggleActive(characterId: string, isActive: boolean) {
    const character = await this.findCharacter(characterId);
    if (!character) throw new Error('CHARACTER_NOT_FOUND');

    return this.prisma.character.update({
      where: { id: character.id },
      data: { isActive },
    });
  }

  async upsertCharacter(char: ManifestCharacter) {
    return this.prisma.character.upsert({
      where: { id: char.id },
      create: {
        id: char.id,
        name: char.name,
        series: char.series,
        description: char.description,
        gender: char.gender,
        baseRarity: char.baseRarity,
        tags: char.tags,
        imageUrls: char.images,
      },
      update: {
        name: char.name,
        series: char.series,
        description: char.description,
        gender: char.gender,
        baseRarity: char.baseRarity,
        tags: char.tags,
        imageUrls: char.images,
      },
    });
  }

  async getStats(userId?: string) {
    if (!userId && this.redis) {
      const cached = await this.redis.get('cache:character_stats');
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (_) {}
      }
    }

    const [rarityGroups, genderGroups, totalActive] = await Promise.all([
      this.prisma.character.groupBy({
        by: ['baseRarity'],
        where: { isActive: true },
        _count: { _all: true },
      }),
      this.prisma.character.groupBy({
        by: ['gender'],
        where: { isActive: true },
        _count: { _all: true },
      }),
      this.prisma.character.count({ where: { isActive: true } }),
    ]);

    const rarities: Rarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
    const rarityCounts: Record<string, number> = {
      COMMON: 0,
      UNCOMMON: 0,
      RARE: 0,
      EPIC: 0,
      LEGENDARY: 0,
    };
    for (const rg of rarityGroups) {
      rarityCounts[rg.baseRarity] = rg._count._all;
    }

    const genderCounts: Record<string, number> = {
      FEMALE: 0,
      MALE: 0,
      OTHER: 0,
    };
    for (const gg of genderGroups) {
      genderCounts[gg.gender] = gg._count._all;
    }

    let totalWeight = 0;
    for (const r of rarities) {
      totalWeight += rarityCounts[r] * (RARITY_BASE_WEIGHTS[r] ?? 100);
    }

    const breakdown = rarities.map((r) => {
      const count = rarityCounts[r];
      const baseWeight = RARITY_BASE_WEIGHTS[r] ?? 100;
      const categoryWeight = count * baseWeight;
      const categoryChance = totalWeight > 0 ? (categoryWeight / totalWeight) * 100 : 0;
      const singleBaseChance = totalWeight > 0 ? (baseWeight / totalWeight) * 100 : 0;
      const singleWishChance = totalWeight > 0 ? (Math.round(baseWeight * 1.5) / totalWeight) * 100 : 0;
      const singleStarWishChance = totalWeight > 0 ? (Math.round(baseWeight * 2.0) / totalWeight) * 100 : 0;

      return {
        rarity: r,
        count,
        percentOfTotal: totalActive > 0 ? (count / totalActive) * 100 : 0,
        baseWeight,
        categoryWeight,
        categoryChance,
        oneInX: categoryWeight > 0 ? Math.round(totalWeight / categoryWeight) : null,
        singleBaseChance,
        singleBaseOneInX: baseWeight > 0 ? Math.round(totalWeight / baseWeight) : null,
        singleWishChance,
        singleWishOneInX: baseWeight > 0 ? Math.round(totalWeight / Math.round(baseWeight * 1.5)) : null,
        singleStarWishChance,
        singleStarWishOneInX: baseWeight > 0 ? Math.round(totalWeight / Math.round(baseWeight * 2.0)) : null,
      };
    });

    let userWishlistStats = null;
    if (userId) {
      const userWishes = await this.prisma.wishlistEntry.findMany({
        where: { userId },
        include: { character: { select: { id: true, baseRarity: true, name: true } } },
      });

      let totalWishWeight = 0;
      for (const w of userWishes) {
        const baseW = RARITY_BASE_WEIGHTS[w.character.baseRarity] ?? 100;
        const multiplier = w.isStarWish ? 2.0 : 1.5;
        totalWishWeight += Math.max(1, Math.round(baseW * multiplier));
      }

      const anyWishChance = totalWeight > 0 ? (totalWishWeight / totalWeight) * 100 : 0;
      userWishlistStats = {
        count: userWishes.length,
        maxItems: config.WISHLIST_MAX_ITEMS,
        totalWishWeight,
        anyWishChance,
        oneInX: totalWishWeight > 0 ? Math.round(totalWeight / totalWishWeight) : null,
      };
    }

    const result = {
      totalCharacters: totalActive,
      totalWeight,
      wishlistMaxItems: config.WISHLIST_MAX_ITEMS,
      genderCounts,
      breakdown,
      userWishlistStats,
    };

    if (!userId && this.redis) {
      await this.redis.set('cache:character_stats', JSON.stringify(result), 'EX', 30);
    }

    return result;
  }
}
