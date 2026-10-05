import { PrismaClient, Gender, Rarity } from '@prisma/client';
import { CooldownService } from './CooldownService.js';
import { CharacterService } from './CharacterService.js';
import {
  calculateCharacterWeight,
  RARITY_DIVORCE_VALUES,
  RARITY_BASE_WEIGHTS,
  RollBonuses,
} from '../utils/rarityCalculator.js';
import { config } from '../config.js';

export interface RollOptions {
  userId: string;
  groupId: string;
  genderFilter?: Gender;
  bonuses?: RollBonuses;
}

interface CachedPoolItem {
  id: string;
  baseRarity: Rarity;
  gender: Gender;
}

export class RollService {
  private inMemoryPool: CachedPoolItem[] = [];
  private poolLoaded = false;
  private isLoadingPool = false;

  private cachedTotalClaims = 0;
  private lastTotalClaimsFetch = 0;
  private cachedClaimedRecords: Array<{ id: string; baseRarity: Rarity; gender: Gender; claimCount: number }> = [];
  private lastClaimedRecordsFetch = 0;

  constructor(
    private prisma: PrismaClient,
    private cooldownService: CooldownService,
    private characterService: CharacterService
  ) {}

  private async getTotalClaims(): Promise<number> {
    const now = Date.now();
    if (now - this.lastTotalClaimsFetch > 60000 || this.cachedTotalClaims === 0) {
      this.cachedTotalClaims = await this.prisma.haremEntry.count();
      this.lastTotalClaimsFetch = now;
    }
    return this.cachedTotalClaims;
  }

  private async getClaimedRecords(): Promise<Array<{ id: string; baseRarity: Rarity; gender: Gender; claimCount: number }>> {
    const now = Date.now();
    if (now - this.lastClaimedRecordsFetch > 15000 || this.cachedClaimedRecords.length === 0) {
      this.cachedClaimedRecords = await this.prisma.character.findMany({
        where: { isActive: true, claimCount: { gt: 0 } },
        select: { id: true, baseRarity: true, gender: true, claimCount: true },
      });
      this.lastClaimedRecordsFetch = now;
    }
    return this.cachedClaimedRecords;
  }

  /**
   * Carrega em memória o conjunto de personagens ativos comuns (claimCount = 0).
   * Ocupa ~15MB de RAM e elimina queries pesadas no banco durante o /roll.
   */
  async loadPool(): Promise<void> {
    if (this.isLoadingPool) return;
    this.isLoadingPool = true;
    try {
      const items = await this.prisma.character.findMany({
        where: { isActive: true },
        select: {
          id: true,
          baseRarity: true,
          gender: true,
        },
      });
      this.inMemoryPool = items;
      this.poolLoaded = true;
    } finally {
      this.isLoadingPool = false;
    }
  }

  invalidatePool(): void {
    this.poolLoaded = false;
    this.lastClaimedRecordsFetch = 0;
    this.lastTotalClaimsFetch = 0;
  }

  async roll(options: RollOptions) {
    const { userId, groupId, genderFilter, bonuses } = options;
    const extraMaxRolls = bonuses?.extraMaxRolls ?? 0;

    // 1. Débito atômico de 1 roll no Redis antes de processar
    const { success: rollAvailable, rollsState } = await this.cooldownService.consumeRoll(
      userId,
      extraMaxRolls
    );

    if (!rollAvailable) {
      return {
        success: false,
        error: {
          code: 'COOLDOWN_ACTIVE',
          message: `Você não possui rolls disponíveis (${rollsState.availableRolls}/${rollsState.maxRolls})! Próximo roll em ${Math.ceil(rollsState.secondsToNext / 60)} min. Recarga total em ${Math.ceil(rollsState.fullRechargeSeconds / 60)} min.`,
          remainingSeconds: rollsState.secondsToNext,
          retryAfter: rollsState.fullRechargeAt,
          currentRolls: rollsState.availableRolls,
          maxRolls: rollsState.maxRolls,
          fullRechargeSeconds: rollsState.fullRechargeSeconds,
          fullRechargeAt: rollsState.fullRechargeAt,
        },
      };
    }

    try {
      // 2. Garantir cache do pool em memória
      if (!this.poolLoaded || this.inMemoryPool.length === 0) {
        await this.loadPool();
      }

      // 3. Consultas secundárias leves em paralelo
      const [disabledRecords, wishlistRecords, claimedRecords, totalClaims] = await Promise.all([
        this.prisma.groupDisabledSeries.findMany({
          where: { groupId },
          select: { characterId: true },
        }),
        this.prisma.wishlistEntry.findMany({
          where: { userId },
          select: { characterId: true, isStarWish: true },
        }),
        this.getClaimedRecords(),
        this.getTotalClaims(),
      ]);

      const disabledIds = new Set(disabledRecords.map((d) => d.characterId));
      const wishMap = new Map(wishlistRecords.map((w) => [w.characterId, w.isStarWish]));
      const claimedMap = new Map(claimedRecords.map((c) => [c.id, c.claimCount]));

      // 4. Filtrar candidatos elegíveis
      let candidates = this.inMemoryPool;
      if (genderFilter) {
        candidates = candidates.filter((c) => c.gender === genderFilter);
      }
      if (disabledIds.size > 0) {
        candidates = candidates.filter((c) => !disabledIds.has(c.id));
      }

      if (candidates.length === 0) {
        throw new Error('NO_CHARACTERS_AVAILABLE');
      }

      // 5. Particionamento O(1) de pesos de sorteio
      // Separa os itens com modificadores especiais (wishlist ou claimCount > 0) dos comuns
      const specialCandidates: { id: string; weight: number }[] = [];
      let specialTotalWeight = 0;

      // Agrupa os itens normais por raridade (todos têm o mesmo peso exato)
      const normalByRarity: Record<Rarity, string[]> = {
        COMMON: [],
        UNCOMMON: [],
        RARE: [],
        EPIC: [],
        LEGENDARY: [],
      };

      for (const char of candidates) {
        const isWish = wishMap.has(char.id);
        const claimCount = claimedMap.get(char.id) ?? 0;

        if (isWish || claimCount > 0) {
          const weight = calculateCharacterWeight({
            baseRarity: char.baseRarity,
            claimCount,
            totalActiveUsersOrClaims: totalClaims,
            isWishlisted: isWish,
            isStarWish: wishMap.get(char.id) ?? false,
            bonuses,
          });
          specialCandidates.push({ id: char.id, weight });
          specialTotalWeight += weight;
        } else {
          normalByRarity[char.baseRarity].push(char.id);
        }
      }

      // Calcula peso base por raridade considerando multiplicadores
      const rarityWeights: Record<Rarity, number> = {
        COMMON: RARITY_BASE_WEIGHTS.COMMON * (bonuses?.rarityMultipliers?.COMMON ?? 1.0),
        UNCOMMON: RARITY_BASE_WEIGHTS.UNCOMMON * (bonuses?.rarityMultipliers?.UNCOMMON ?? 1.0),
        RARE: RARITY_BASE_WEIGHTS.RARE * (bonuses?.rarityMultipliers?.RARE ?? 1.0),
        EPIC: RARITY_BASE_WEIGHTS.EPIC * (bonuses?.rarityMultipliers?.EPIC ?? 1.0),
        LEGENDARY: RARITY_BASE_WEIGHTS.LEGENDARY * (bonuses?.rarityMultipliers?.LEGENDARY ?? 1.0),
      };

      const normalTierWeights: { rarity: Rarity; totalWeight: number }[] = [];
      let normalTotalWeight = 0;

      for (const r of ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as Rarity[]) {
        const count = normalByRarity[r].length;
        if (count > 0) {
          const tierWeight = count * rarityWeights[r];
          normalTierWeights.push({ rarity: r, totalWeight: tierWeight });
          normalTotalWeight += tierWeight;
        }
      }

      const grandTotalWeight = specialTotalWeight + normalTotalWeight;
      const randomVal = Math.random() * grandTotalWeight;

      let chosenId: string;

      if (randomVal < specialTotalWeight) {
        // Sorteou item especial (wishlist ou casado)
        let acc = 0;
        chosenId = specialCandidates[0].id;
        for (const item of specialCandidates) {
          acc += item.weight;
          if (randomVal <= acc) {
            chosenId = item.id;
            break;
          }
        }
      } else {
        // Sorteou item normal: seleciona a faixa de raridade e escolhe uniformemente em O(1)
        let remainder = randomVal - specialTotalWeight;
        let chosenRarity: Rarity = normalTierWeights[0].rarity;

        for (const tier of normalTierWeights) {
          if (remainder <= tier.totalWeight) {
            chosenRarity = tier.rarity;
            break;
          }
          remainder -= tier.totalWeight;
        }

        const tierList = normalByRarity[chosenRarity];
        const randomIndex = Math.floor(Math.random() * tierList.length);
        chosenId = tierList[randomIndex];
      }

      // 6. Buscar detalhes completos apenas do personagem sorteado
      const chosen = await this.prisma.character.findUnique({
        where: { id: chosenId },
        include: {
          haremEntries: {
            select: {
              id: true,
              userId: true,
              keys: true,
              user: {
                select: { id: true, name: true },
              },
            },
          },
        },
      });

      if (!chosen) {
        throw new Error('CHOSEN_CHARACTER_NOT_FOUND');
      }

      // 7. Processar estado de dono e recompensas
      const existingHaremEntry = chosen.haremEntries[0];
      const isOwner = existingHaremEntry?.userId === userId;
      const isClaimed = !!existingHaremEntry;

      let keyProgress = null;
      let kakeraCrystalValue: number | null = null;

      if (isClaimed) {
        if (isOwner) {
          // Dono rolou o próprio personagem -> +1 Key
          const updatedHarem = await this.prisma.haremEntry.update({
            where: { id: existingHaremEntry.id },
            data: { keys: { increment: 1 } },
          });

          const newKeys = updatedHarem.keys;
          let becameSoulmate = false;

          if (newKeys >= config.SOULMATE_KEYS_REQUIRED) {
            await this.prisma.soulmate.upsert({
              where: {
                userId_characterId: {
                  userId,
                  characterId: chosen.id,
                },
              },
              create: {
                userId,
                characterId: chosen.id,
              },
              update: {},
            });
            becameSoulmate = true;
          }

          keyProgress = {
            currentKeys: newKeys,
            requiredForSoulmate: config.SOULMATE_KEYS_REQUIRED,
            isSoulmate: newKeys >= config.SOULMATE_KEYS_REQUIRED,
            becameSoulmateNow: becameSoulmate && newKeys === config.SOULMATE_KEYS_REQUIRED,
          };
        } else {
          // Outro usuário é dono -> cristal de kakera
          const baseRefund = RARITY_DIVORCE_VALUES[chosen.baseRarity] ?? 50;
          kakeraCrystalValue = Math.round(baseRefund * 0.2) + existingHaremEntry.keys * 5;
        }
      } else {
        // Livre: lock não exclusivo de 300 segundos (qualquer um do grupo pode casar)
        await this.cooldownService.setClaimLock(groupId, chosen.id, userId);
      }

      const now = Date.now();
      const lockExpiresAt = !isClaimed ? new Date(now + config.CLAIM_LOCK_SECONDS * 1000) : null;
      const nextRollAt = new Date(now + config.COOLDOWN_ROLL_SECONDS * 1000);

      return {
        success: true,
        data: {
          character: {
            id: chosen.id,
            name: chosen.name,
            series: chosen.series,
            description: chosen.description,
            gender: chosen.gender,
            rarity: chosen.baseRarity,
            imageUrl: this.characterService.getRandomImageUrl(chosen.id, chosen.imageUrls),
            imageUrls: chosen.imageUrls.map((img) => this.characterService.formatImageUrl(chosen.id, img)),
            tags: chosen.tags,
          },
          available: !isClaimed,
          isWishlist: wishMap.has(chosen.id),
          isStarWish: wishMap.get(chosen.id) ?? false,
          isOwner,
          owner: isClaimed
            ? {
                id: existingHaremEntry.user.id,
                name: existingHaremEntry.user.name,
              }
            : null,
          keyProgress,
          kakeraValue: kakeraCrystalValue,
          lockExpiresAt,
          nextRollAt,
          appliedBonuses: bonuses
            ? {
                donorBadge: bonuses.donorBadge ?? null,
                wishlistMultiplier: bonuses.wishlistMultiplier ?? null,
                starWishMultiplier: bonuses.starWishMultiplier ?? null,
                rarityMultipliers: bonuses.rarityMultipliers ?? null,
                extraMaxRolls: bonuses.extraMaxRolls ?? null,
              }
            : null,
          rollsRemaining: rollsState.availableRolls,
          maxRolls: rollsState.maxRolls,
          nextRollSeconds: rollsState.secondsToNext,
          fullRechargeSeconds: rollsState.fullRechargeSeconds,
          fullRechargeAt: rollsState.fullRechargeAt,
        },
      };
    } catch (err: any) {
      // Estorna a tentativa caso haja falha não recuperável
      await this.cooldownService.refundRoll(userId, extraMaxRolls);
      if (err.message === 'NO_CHARACTERS_AVAILABLE') {
        return {
          success: false,
          error: {
            code: 'NO_CHARACTERS_AVAILABLE',
            message: 'Nenhum personagem disponível para sorteio com os filtros atuais.',
          },
        };
      }
      throw err;
    }
  }
}
