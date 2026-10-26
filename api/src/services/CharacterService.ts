import { PrismaClient, Rarity, Gender } from '@prisma/client';
import { Redis } from 'ioredis';
import { ManifestCharacter } from '../utils/manifestLoader.js';
import { RARITY_BASE_WEIGHTS } from '../utils/rarityCalculator.js';
import { config } from '../config.js';
import { DomainError } from '../errors/DomainError.js';

export interface CharacterFilter {
  series?: string;
  rarity?: Rarity;
  gender?: Gender;
  tag?: string;
  search?: string;
  page?: number;
  limit?: number;
  maritalStatus?: 'all' | 'single' | 'married' | string;
  sort?: string;
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
      const searchTerms = filter.search.trim().split(/\s+/).filter(Boolean);
      if (searchTerms.length > 1) {
        where.AND = searchTerms.map((term) => ({
          OR: [
            { id: { contains: term, mode: 'insensitive' } },
            { name: { contains: term, mode: 'insensitive' } },
            { series: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
          ],
        }));
      } else {
        where.OR = [
          { id: { contains: filter.search, mode: 'insensitive' } },
          { name: { contains: filter.search, mode: 'insensitive' } },
          { series: { contains: filter.search, mode: 'insensitive' } },
          { description: { contains: filter.search, mode: 'insensitive' } },
        ];
      }
    }
    if (filter.maritalStatus === 'married') {
      where.haremEntries = { some: {} };
    } else if (filter.maritalStatus === 'single') {
      where.haremEntries = { none: {} };
    }

    // Ordenação inicial aleatória alternando 1 de cada raridade em ordem decrescente
    const isRandomSort = filter.sort === 'random' || !filter.sort;
    if (isRandomSort) {
      const rarities: Rarity[] = filter.rarity
        ? [filter.rarity]
        : ['LEGENDARY', 'EPIC', 'RARE', 'UNCOMMON', 'COMMON'];

      const countPerRarity = Math.ceil(limit / rarities.length);

      const conditions: string[] = ['"isActive" = true'];
      const values: any[] = [];
      let paramIdx = 1;

      if (filter.gender) {
        conditions.push(`"gender" = $${paramIdx}::"Gender"`);
        values.push(filter.gender);
        paramIdx++;
      }

      if (filter.maritalStatus === 'single') {
        conditions.push(`NOT EXISTS (SELECT 1 FROM harem_entries h WHERE h."characterId" = characters.id)`);
      } else if (filter.maritalStatus === 'married') {
        conditions.push(`EXISTS (SELECT 1 FROM harem_entries h WHERE h."characterId" = characters.id)`);
      }

      if (filter.series) {
        conditions.push(`"series" ILIKE $${paramIdx}`);
        values.push(`%${filter.series}%`);
        paramIdx++;
      }

      if (filter.tag) {
        conditions.push(`$${paramIdx} = ANY("tags")`);
        values.push(filter.tag);
        paramIdx++;
      }

      if (filter.search) {
        const terms = filter.search.trim().split(/\s+/).filter(Boolean);
        for (const term of terms) {
          conditions.push(`("name" ILIKE $${paramIdx} OR "series" ILIKE $${paramIdx} OR "id" ILIKE $${paramIdx})`);
          values.push(`%${term}%`);
          paramIdx++;
        }
      }

      const baseWhereSql = conditions.join(' AND ');

      const idsPerRarity = await Promise.all(
        rarities.map((r) => {
          const sql = `SELECT id FROM characters WHERE ${baseWhereSql} AND "baseRarity" = $${paramIdx}::"Rarity" ORDER BY random() LIMIT ${countPerRarity}`;
          return this.prisma.$queryRawUnsafe<{ id: string }[]>(sql, ...values, r);
        })
      );

      const orderedIds: string[] = [];
      const maxLen = Math.max(...idsPerRarity.map((l) => l.length), 0);

      for (let i = 0; i < maxLen; i++) {
        for (let r = 0; r < rarities.length; r++) {
          if (idsPerRarity[r][i]) {
            orderedIds.push(idsPerRarity[r][i].id);
          }
        }
      }

      const finalIds = orderedIds.slice(0, limit);

      const [total, characters] = await Promise.all([
        this.prisma.character.count({ where }),
        finalIds.length > 0
          ? this.prisma.character.findMany({
              where: { id: { in: finalIds } },
              include: {
                _count: { select: { wishlists: true } },
                haremEntries: {
                  take: 1,
                  include: {
                    user: { select: { id: true, publicId: true, name: true, platform: true } },
                  },
                },
              },
            })
          : [],
      ]);

      const charMap = new Map(characters.map((c) => [c.id, c]));
      const sortedCharacters = finalIds.map((id) => charMap.get(id)).filter(Boolean);

      return {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        data: sortedCharacters.map((c: any) => {
          const rawOwner = c.haremEntries?.[0]?.user ?? null;
          let owner: any = null;
          if (rawOwner) {
            owner = isTrusted ? rawOwner : { name: rawOwner.name, publicId: rawOwner.publicId };
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

    let orderBy: any = [{ claimCount: 'desc' }, { likeCount: 'desc' }, { name: 'asc' }];
    if (filter.sort === 'name') {
      orderBy = [{ name: 'asc' }];
    } else if (filter.sort === 'rarity') {
      orderBy = [{ baseRarity: 'desc' }, { claimCount: 'desc' }, { name: 'asc' }];
    } else if (filter.sort === 'wishlist') {
      orderBy = [{ wishlists: { _count: 'desc' } }, { claimCount: 'desc' }, { name: 'asc' }];
    } else if (filter.sort === 'popularity' || filter.sort === 'rank' || filter.sort === 'ranking') {
      orderBy = [{ popularityScore: 'desc' }, { rank: 'asc' }, { name: 'asc' }];
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
                select: { id: true, publicId: true, name: true, platform: true },
              },
            },
          },
        },
        orderBy,
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
            : { name: rawOwner.name, publicId: rawOwner.publicId };
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
              select: { id: true, publicId: true, name: true, platform: true },
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
        : { name: rawOwner.name, publicId: rawOwner.publicId };
    }

    const { haremEntries, ...charRest } = character;

    const hasActiveHarem = character.haremEntries.length > 0;
    const hasClaimCount = character.claimCount > 0;
    const hasSoulmates = (character._count?.soulmates ?? 0) > 0;

    let wasEverMarried = hasActiveHarem || hasClaimCount || hasSoulmates;
    if (!wasEverMarried) {
      const divorceTx = await this.prisma.kakeraTransaction.findFirst({
        where: {
          reason: 'DIVORCE',
          metadata: { path: ['characterId'], equals: character.id },
        },
        select: { id: true },
      });
      if (divorceTx) wasEverMarried = true;
    }

    return {
      ...charRest,
      imageUrl: this.getRandomImageUrl(character.id, character.imageUrls),
      imageUrls: character.imageUrls.map((img) => this.formatImageUrl(character.id, img)),
      isClaimed: !!rawOwner,
      wasEverMarried,
      owner,
      claimedInGroup: isTrusted ? (character.haremEntries[0]?.claimedInGroup ?? null) : null,
      wishlistCount: character._count?.wishlists ?? 0,
    };
  }

  /**
   * Retorna os segundos restantes até o próximo reset diário oficial (04:00 BRT / 07:00 UTC)
   */
  getSecondsUntilDailyReset(date: Date = new Date()): number {
    const resetHourUtc = config.DAILY_RESET_HOUR_UTC;
    const resetMinuteUtc = config.DAILY_RESET_MINUTE_UTC || 0;
    const todayReset = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), resetHourUtc, resetMinuteUtc, 0, 0)
    );

    let nextReset: Date;
    if (date.getTime() < todayReset.getTime()) {
      nextReset = todayReset;
    } else {
      nextReset = new Date(todayReset.getTime() + 24 * 60 * 60 * 1000);
    }

    return Math.max(1, Math.ceil((nextReset.getTime() - date.getTime()) / 1000));
  }

  /**
   * Calcula o score de popularidade unificado da waifu:
   * Score = (likes * 10) + (wishlists * 5) + (casado * 5) + (favorita * 5) + (chaves * 2) + bonusMudae
   */
  calculatePopularityScore(char: {
    likeCount?: number;
    wishlistCount?: number;
    isClaimed?: boolean;
    isFavorite?: boolean;
    keys?: number;
    rank?: number | null;
  }): number {
    const likesScore = (char.likeCount || 0) * 10;
    const wishScore = (char.wishlistCount || 0) * 5;
    const claimScore = char.isClaimed ? 5 : 0;
    const favoriteScore = char.isFavorite ? 5 : 0;
    const keysScore = (char.keys || 0) * 2;
    const mudaeBonus = char.rank ? Math.max(0, Math.floor((10000 - char.rank) / 100)) : 0;
    return likesScore + wishScore + claimScore + favoriteScore + keysScore + mudaeBonus;
  }

  /**
   * Recalcula pontualmente o popularityScore de um personagem
   */
  async updateCharacterScore(characterId: string): Promise<number> {
    const char = await this.prisma.character.findUnique({
      where: { id: characterId },
      include: {
        haremEntries: {
          select: { id: true, keys: true, isFavorite: true },
        },
        _count: {
          select: { wishlists: true },
        },
      },
    });

    if (!char) return 0;

    const isClaimed = char.haremEntries.length > 0;
    const isFavorite = char.haremEntries.some((h) => h.isFavorite);
    const keys = char.haremEntries.reduce((acc, h) => acc + (h.keys || 0), 0);
    const wishlistCount = char._count?.wishlists || 0;

    const score = this.calculatePopularityScore({
      likeCount: char.likeCount,
      wishlistCount,
      isClaimed,
      isFavorite,
      keys,
      rank: char.rank,
    });

    await this.prisma.character.update({
      where: { id: char.id },
      data: { popularityScore: score },
    });

    return score;
  }

  /**
   * Recalcula em lote as pontuações e o ranking global de todas as waifus ativas (waifuRank #1, #2, ...)
   */
  async recalculateAllWaifuRanks(): Promise<number> {
    const result = await this.prisma.$executeRaw`
      WITH char_metrics AS (
        SELECT
          c.id,
          c."likeCount",
          c.rank,
          COALESCE(w.wish_cnt, 0) AS wish_cnt,
          CASE WHEN h.char_id IS NOT NULL THEN 1 ELSE 0 END AS is_claimed,
          COALESCE(h.is_fav, 0) AS is_fav,
          COALESCE(h.total_keys, 0) AS total_keys
        FROM characters c
        LEFT JOIN (
          SELECT "characterId", COUNT(*) as wish_cnt FROM wishlist_entries GROUP BY "characterId"
        ) w ON w."characterId" = c.id
        LEFT JOIN (
          SELECT
            "characterId" as char_id,
            MAX(CASE WHEN "isFavorite" = true THEN 1 ELSE 0 END) as is_fav,
            SUM(COALESCE("keys", 0)) as total_keys
          FROM harem_entries
          GROUP BY "characterId"
        ) h ON h.char_id = c.id
        WHERE c."isActive" = true
      ),
      calculated_scores AS (
        SELECT
          id,
          (
            ("likeCount" * 10) +
            (wish_cnt * 5) +
            (is_claimed * 5) +
            (is_fav * 5) +
            (total_keys * 2) +
            CASE
              WHEN rank IS NOT NULL AND rank < 10000 THEN FLOOR((10000 - rank) / 100)
              ELSE 0
            END
          )::integer AS score
        FROM char_metrics
      ),
      ranked AS (
        SELECT
          cs.id,
          cs.score,
          ROW_NUMBER() OVER (
            ORDER BY cs.score DESC, c.rank ASC NULLS LAST, c."claimCount" DESC, c."likeCount" DESC, c.name ASC
          ) as r
        FROM calculated_scores cs
        JOIN characters c ON c.id = cs.id
      )
      UPDATE characters
      SET
        "popularityScore" = ranked.score,
        "waifuRank" = ranked.r
      FROM ranked
      WHERE characters.id = ranked.id;
    `;
    return Number(result);
  }

  /**
   * Registra like no personagem respeitando limite diário (1 por personagem até as 04:00)
   */
  async likeCharacter(userId: string, characterId: string) {
    const character = await this.findCharacter(characterId);

    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.', 404);
    }

    const cooldownKey = `cooldown:like:${userId}:${character.id}`;
    if (this.redis) {
      const ttl = await this.redis.ttl(cooldownKey);
      if (ttl > 0) {
        const hours = Math.floor(ttl / 3600);
        const minutes = Math.floor((ttl % 3600) / 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        throw new DomainError(
          'LIKE_ALREADY_GIVEN_TODAY',
          `Você já curtiu ${character.name} hoje! Novo like disponível em ${timeStr} (às 04:00).`,
          429
        );
      }
    }

    const updated = await this.prisma.character.update({
      where: { id: character.id },
      data: {
        likeCount: { increment: 1 },
      },
    });

    if (this.redis) {
      const ttl = this.getSecondsUntilDailyReset();
      await this.redis.set(cooldownKey, '1', 'EX', ttl);
    }

    // Atualiza o score de popularidade imediatamente
    await this.updateCharacterScore(character.id);

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
