import { PrismaClient, Rarity, Gender } from '@prisma/client';
import { Redis } from 'ioredis';
import { config } from '../config.js';

export interface CatalogCardItem {
  id: string;
  name: string;
  series: string;
  description: string | null;
  baseRarity: Rarity;
  rank: number | null;
  waifuRank: number | null;
  imageUrls: string[];
  likeCount: number;
  claimCount: number;
  gender: string;
  tags: string[];
  isWishlisted?: boolean;
  isLikedToday?: boolean;
}

interface PoolItem {
  id: string;
  gender: Gender;
}

export class CatalogService {
  private inMemoryPool: Record<Rarity, PoolItem[]> = {
    LEGENDARY: [],
    EPIC: [],
    RARE: [],
    UNCOMMON: [],
    COMMON: [],
  };
  private cachedMarriedSet: Set<string> = new Set();
  private lastPoolRefresh = 0;
  private lastMarriedRefresh = 0;
  private isLoadingPool = false;

  constructor(
    private prisma: PrismaClient,
    private redis?: Redis
  ) {}

  /**
   * Recarrega pool de IDs de personagens ativos por raridade
   */
  async refreshPoolIfNeeded(force = false): Promise<void> {
    const now = Date.now();
    if (!force && this.lastPoolRefresh > 0 && now - this.lastPoolRefresh < 5 * 60 * 1000) {
      return;
    }

    if (this.isLoadingPool) return;
    this.isLoadingPool = true;

    try {
      const characters = await this.prisma.character.findMany({
        where: { isActive: true },
        select: { id: true, baseRarity: true, gender: true },
      });

      const nextPool: Record<Rarity, PoolItem[]> = {
        LEGENDARY: [],
        EPIC: [],
        RARE: [],
        UNCOMMON: [],
        COMMON: [],
      };

      for (const char of characters) {
        if (nextPool[char.baseRarity]) {
          nextPool[char.baseRarity].push({ id: char.id, gender: char.gender });
        }
      }

      this.inMemoryPool = nextPool;
      this.lastPoolRefresh = now;
    } finally {
      this.isLoadingPool = false;
    }
  }

  /**
   * Recarrega conjunto de personagens casados (harem_entries) com cache leve de 30s
   */
  async refreshMarriedSetIfNeeded(force = false): Promise<Set<string>> {
    const now = Date.now();
    if (!force && this.lastMarriedRefresh > 0 && now - this.lastMarriedRefresh < 30 * 1000) {
      return this.cachedMarriedSet;
    }

    const marriedRecords = await this.prisma.haremEntry.findMany({
      select: { characterId: true },
    });

    this.cachedMarriedSet = new Set(marriedRecords.map((m) => m.characterId));
    this.lastMarriedRefresh = now;
    return this.cachedMarriedSet;
  }

  /**
   * Sorteia IDs válidos para uma raridade respeitando solteiros, gênero e exclusões
   */
  private sampleRarityIds(
    rarity: Rarity,
    count: number,
    marriedSet: Set<string>,
    excludeSet: Set<string>,
    selectedSet: Set<string>,
    genderFilter?: 'ALL' | 'FEMALE' | 'MALE'
  ): string[] {
    const pool = this.inMemoryPool[rarity] || [];
    if (pool.length === 0) return [];

    const candidates: string[] = [];
    const maxAttempts = pool.length * 2;
    let attempts = 0;

    const matchesGender = (itemGender: Gender) => {
      if (!genderFilter || genderFilter === 'ALL') return true;
      if (itemGender === 'OTHER') return true;
      return itemGender === genderFilter;
    };

    while (candidates.length < count && attempts < maxAttempts) {
      attempts++;
      const randIdx = Math.floor(Math.random() * pool.length);
      const item = pool[randIdx];

      if (!item || !matchesGender(item.gender) || marriedSet.has(item.id) || excludeSet.has(item.id) || selectedSet.has(item.id)) {
        continue;
      }

      candidates.push(item.id);
      selectedSet.add(item.id);
    }

    // Se pool específico esgotou por exclusões, relaxa excludeSet (mantém estrito marriedSet e gender)
    if (candidates.length < count) {
      attempts = 0;
      while (candidates.length < count && attempts < maxAttempts) {
        attempts++;
        const randIdx = Math.floor(Math.random() * pool.length);
        const item = pool[randIdx];

        if (!item || !matchesGender(item.gender) || marriedSet.has(item.id) || selectedSet.has(item.id)) {
          continue;
        }

        candidates.push(item.id);
        selectedSet.add(item.id);
      }
    }

    return candidates;
  }

  /**
   * Obtém lote de 15 cards Waifinder com distribuição de raridade:
   * 1 Lendário, 2 Épicos, 3 Raros, 4 Incomuns e 5 Comuns.
   */
  async getDeck(options: {
    userId?: string | null;
    excludeIds?: string[];
    gender?: 'ALL' | 'FEMALE' | 'MALE';
  }): Promise<{ characters: CatalogCardItem[] }> {
    await this.refreshPoolIfNeeded();
    const marriedSet = await this.refreshMarriedSetIfNeeded();
    const excludeSet = new Set(options.excludeIds || []);
    const selectedSet = new Set<string>();
    const genderFilter = options.gender || 'ALL';

    const distribution: Array<{ rarity: Rarity; count: number }> = [
      { rarity: 'LEGENDARY', count: 1 },
      { rarity: 'EPIC', count: 2 },
      { rarity: 'RARE', count: 3 },
      { rarity: 'UNCOMMON', count: 4 },
      { rarity: 'COMMON', count: 5 },
    ];

    const chosenIds: string[] = [];

    for (const item of distribution) {
      const sampled = this.sampleRarityIds(item.rarity, item.count, marriedSet, excludeSet, selectedSet, genderFilter);
      chosenIds.push(...sampled);

      // Fallback em caso de falta de itens solteiros na categoria
      if (sampled.length < item.count) {
        const missing = item.count - sampled.length;
        const fallbackRarities: Rarity[] = ['EPIC', 'RARE', 'UNCOMMON', 'COMMON'];
        for (const fb of fallbackRarities) {
          if (sampled.length >= item.count) break;
          const fbSampled = this.sampleRarityIds(fb, missing, marriedSet, excludeSet, selectedSet, genderFilter);
          chosenIds.push(...fbSampled);
        }
      }
    }

    if (chosenIds.length === 0) {
      return { characters: [] };
    }

    // Busca detalhes completos dos personagens sorteados
    const dbCharacters = await this.prisma.character.findMany({
      where: { id: { in: chosenIds } },
      select: {
        id: true,
        name: true,
        series: true,
        description: true,
        baseRarity: true,
        rank: true,
        waifuRank: true,
        imageUrls: true,
        likeCount: true,
        claimCount: true,
        gender: true,
        tags: true,
      },
    });

    const charMap = new Map(dbCharacters.map((c) => [c.id, c]));

    // Dados de sessão do usuário (se logado)
    let userWishlistIds = new Set<string>();
    const likedTodayMap = new Map<string, boolean>();

    if (options.userId) {
      const wishlists = await this.prisma.wishlistEntry.findMany({
        where: {
          userId: options.userId,
          characterId: { in: chosenIds },
        },
        select: { characterId: true },
      });
      userWishlistIds = new Set(wishlists.map((w) => w.characterId));

      if (this.redis) {
        await Promise.all(
          chosenIds.map(async (charId) => {
            const cooldownKey = `cooldown:like:${options.userId}:${charId}`;
            const ttl = await this.redis!.ttl(cooldownKey);
            likedTodayMap.set(charId, ttl > 0);
          })
        );
      }
    }

    // Monta itens com flags de usuário
    const orderedItems: CatalogCardItem[] = [];
    for (const id of chosenIds) {
      const char = charMap.get(id);
      if (!char) continue;

      const formattedImageUrls = (char.imageUrls && char.imageUrls.length > 0)
        ? char.imageUrls.map((img) => {
            if (!img) return `${config.PUBLIC_BASE_URL}/media/characters/${char.id}/default.jpg`;
            if (img.startsWith('http://') || img.startsWith('https://')) {
              try {
                const u = new URL(img);
                if (u.pathname.startsWith('/characters/')) {
                  u.pathname = '/media' + u.pathname;
                  return u.toString();
                }
              } catch (_) {}
              return img;
            }
            if (img.startsWith('/media/')) return `${config.PUBLIC_BASE_URL}${img}`;
            if (img.startsWith('media/')) return `${config.PUBLIC_BASE_URL}/${img}`;
            const clean = img.startsWith('/') ? img : `/${img}`;
            return `${config.PUBLIC_BASE_URL}/media${clean}`;
          })
        : [`${config.PUBLIC_BASE_URL}/media/characters/${char.id}/default.jpg`];

      orderedItems.push({
        id: char.id,
        name: char.name,
        series: char.series,
        description: char.description,
        baseRarity: char.baseRarity,
        rank: char.rank,
        waifuRank: char.waifuRank,
        imageUrls: formattedImageUrls,
        likeCount: char.likeCount,
        claimCount: char.claimCount,
        gender: char.gender,
        tags: char.tags,
        isWishlisted: userWishlistIds.has(char.id),
        isLikedToday: likedTodayMap.get(char.id) || false,
      });
    }

    // Embaralha (Fisher-Yates) para que a ordem no lote de 15 seja variada
    for (let i = orderedItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [orderedItems[i], orderedItems[j]] = [orderedItems[j], orderedItems[i]];
    }

    return { characters: orderedItems };
  }
}
