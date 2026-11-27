import { PrismaClient, Gender, Rarity } from '@prisma/client';
import { CooldownService, UserRollsState } from './CooldownService.js';
import { CharacterService } from './CharacterService.js';
import {
  calculateCharacterWeight,
  calculateRollRankWeight,
  calculateWeeklyLegendaryMultiplier,
  RARITY_DIVORCE_VALUES,
  KAKERA_CRYSTAL_BASE,
  KAKERA_CRYSTAL_KEY_BONUS,
  RARITY_BASE_WEIGHTS,
  RollBonuses,
} from '../utils/rarityCalculator.js';
import { config, getLegendaryChanceCap } from '../config.js';
import { COMPETITOR_INVESTMENT_REFUND_RATE } from './MarketInvestmentService.js';
import { withBusinessSpan, withSpan, setAttrs, addEvent, chatIdAttr, userIdAttr, recordError, withTxSpans, context, trace, type Span } from '../telemetry.js';

export interface RollOptions {
  userId: string;
  groupId: string;
  genderFilter?: Gender;
  bonuses?: RollBonuses;
  excludeCharacterIds?: string[];
}

interface CachedPoolItem {
  id: string;
  baseRarity: Rarity;
  gender: Gender;
  isMythic?: boolean;
  rank?: number | null;
  rankWeight: number;
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

  async getWeeklyLegendaryCount(userId: string): Promise<number> {
    const cached = await this.cooldownService.getWeeklyLegendaryCount(userId);
    if (cached !== null) return cached;

    const cycle = this.cooldownService.getWeeklyCycleInfo();
    const count = await this.prisma.haremEntry.count({
      where: {
        userId,
        claimedAt: { gte: cycle.currentCycleStart },
        character: { baseRarity: 'LEGENDARY' },
      },
    });
    await this.cooldownService.setWeeklyLegendaryCount(userId, count);
    return count;
  }

  /**
   * Carrega em memória o conjunto de personagens ativos comuns (claimCount = 0).
   * Ocupa ~15MB de RAM e elimina queries pesadas no banco durante o /roll.
   */
  async loadPool(): Promise<void> {
    if (this.isLoadingPool) return;
    // Span próprio; fora de request (pré-carga no startup) vira raiz de um trace novo.
    const hasParent = Boolean(trace.getSpan(context.active()));
    return withSpan('pool load', { root: !hasParent }, (span) => this.loadPoolImpl(span));
  }

  private async loadPoolImpl(span: Span): Promise<void> {
    if (this.isLoadingPool) return;
    this.isLoadingPool = true;
    let source = 'db';
    try {
      let items = await this.prisma.character.findMany({
        where: { isActive: true },
        select: {
          id: true,
          baseRarity: true,
          gender: true,
          isMythic: true,
          rank: true,
        },
      });

      // Se o banco local estiver vazio e UPSTREAM_API_URL estiver setada, carrega o pool do Hub
      if (items.length === 0 && config.UPSTREAM_API_URL) {
        console.log('🌐 [RollService] Banco local vazio. Carregando pool de sorteio do Hub remoto...');
        try {
          const base = config.UPSTREAM_API_URL.replace(/\/+$/, '');
          const authHeader: Record<string, string> = config.UPSTREAM_API_KEY ? { Authorization: `Bearer ${config.UPSTREAM_API_KEY}` } : {};
          const res = await fetch(`${base}/api/v1/external/characters/pool`, { headers: authHeader });
          if (res.ok) {
            const data = (await res.json()) as any;
            if (data.success && Array.isArray(data.pool)) {
              items = data.pool;
              source = 'hub';
              console.log(`✅ [RollService] Pool remoto carregado com ${items.length} personagens em RAM!`);
            }
          }
        } catch (poolErr: any) {
          console.error('[RollService] Falha ao carregar pool remoto:', poolErr.message);
          recordError(span, poolErr, 'pool_hub_fetch_failed');
        }
      }

      this.inMemoryPool = items.map((c: any) => ({
        id: c.id,
        baseRarity: c.baseRarity,
        gender: c.gender,
        isMythic: Boolean(c.isMythic),
        rank: c.rank,
        rankWeight: calculateRollRankWeight(
          c.rank,
          config.ROLL_RANK_MAX_DIFFICULTY,
          config.ROLL_RANK_REF_CUTOFF
        ),
      }));
      this.poolLoaded = true;
      setAttrs({ 'waifu.pool.size': this.inMemoryPool.length, 'waifu.pool.source': source }, span);
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
    return withBusinessSpan(
      'roll',
      {
        'waifu.user.id': userIdAttr(options.userId),
        'waifu.group.id': chatIdAttr(options.groupId),
        'waifu.roll.free': Boolean(options.bonuses?.isFreeRoll),
        'waifu.roll.gender_filter': options.genderFilter,
      },
      () => this.rollImpl(options)
    );
  }

  private async rollImpl(options: RollOptions) {
    const { userId, groupId, genderFilter, bonuses } = options;
    const extraMaxRolls = bonuses?.extraMaxRolls ?? 0;
    const isFreeRoll = Boolean(bonuses?.isFreeRoll);
    const rollSpan = trace.getActiveSpan();

    let rollAvailable = true;
    let rollsState: UserRollsState;

    if (isFreeRoll) {
      // Roll gratuito (ex: bônus de colheita da fazenda) - não debita do cooldown/banco de rolls
      rollsState = await withSpan('roll cooldown.check', {}, () => this.cooldownService.getUserRolls(userId, extraMaxRolls));
    } else {
      // 1. Débito atômico de 1 roll no Redis antes de processar
      const consumeRes = await withSpan('roll cooldown.consume', {}, () => this.cooldownService.consumeRoll(userId, extraMaxRolls));
      rollAvailable = consumeRes.success;
      rollsState = consumeRes.rollsState;
      addEvent(rollAvailable ? 'cooldown.consumed' : 'cooldown.blocked', { 'waifu.rolls.available': rollsState.availableRolls });
    }

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

    // Declarado fora do try: o catch precisa saber se o roll já foi estornado (Mítico) para não estornar de novo
    let mythicRollRefunded = false;
    try {
      // 2. Garantir cache do pool em memória
      let poolSource = 'memory';
      if (!this.poolLoaded || this.inMemoryPool.length === 0) {
        await this.loadPool();
        poolSource = 'db';
        addEvent('pool.loaded', { 'waifu.pool.size': this.inMemoryPool.length });
      }
      setAttrs({ 'waifu.pool.size': this.inMemoryPool.length, 'waifu.pool.source': poolSource });

      // 3. Consultas secundárias leves em paralelo
      const [disabledRecords, wishlistRecords, claimedRecords, totalClaims, investmentRecords, weeklyLegCount] = await withSpan('roll context.load', {}, () => Promise.all([
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
        this.prisma.characterInvestment.findMany({
          where: { userId },
          select: { characterId: true, shares: true },
        }),
        this.getWeeklyLegendaryCount(userId),
      ]));

      const weeklyLegMultiplier = calculateWeeklyLegendaryMultiplier(weeklyLegCount, config.WEEKLY_LEGENDARY_HARD_CAP);
      setAttrs({
        'waifu.roll.weekly_legendaries': weeklyLegCount,
        'waifu.roll.weekly_leg_multiplier': weeklyLegMultiplier,
        'waifu.roll.excluded_count': options.excludeCharacterIds?.length ?? 0,
      }, rollSpan);

      const disabledIds = new Set(disabledRecords.map((d) => d.characterId));
      const excludedIds = new Set<string>();
      if (Array.isArray(options.excludeCharacterIds) && options.excludeCharacterIds.length > 0) {
        for (const id of options.excludeCharacterIds) {
          if (typeof id === 'string' && id.trim()) {
            excludedIds.add(id.trim());
          }
        }
      }
      const wishMap = new Map(wishlistRecords.map((w) => [w.characterId, w.isStarWish]));
      const claimedMap = new Map(claimedRecords.map((c) => [c.id, c.claimCount]));
      const investmentMap = new Map(investmentRecords.map((i) => [i.characterId, i.shares]));

      // 4-5. Filtragem do pool em memória + pesos + sorteio (CPU pura sobre ~200 mil itens)
      const picked = withSpan('roll pool.select', {}, (span) => {
        // 4. Filtrar candidatos elegíveis
        let candidates = this.inMemoryPool;
        if (genderFilter) {
          if (genderFilter === 'FEMALE') {
            candidates = candidates.filter((c) => c.gender === 'FEMALE' || c.gender === 'OTHER');
          } else if (genderFilter === 'MALE') {
            candidates = candidates.filter((c) => c.gender === 'MALE' || c.gender === 'OTHER');
          } else {
            candidates = candidates.filter((c) => c.gender === genderFilter);
          }
        }
        if (disabledIds.size > 0) {
          candidates = candidates.filter((c) => !disabledIds.has(c.id));
        }
        if (excludedIds.size > 0) {
          const nonExcluded = candidates.filter((c) => !excludedIds.has(c.id));
          // Só aplica exclusão se ainda restarem candidatos disponíveis
          if (nonExcluded.length > 0) {
            candidates = nonExcluded;
          }
        }

        if (candidates.length === 0) {
          return null;
        }

        // 5. Particionamento O(1) de pesos de sorteio
        // Separa os itens com modificadores especiais (wishlist ou claimCount > 0) dos comuns
        const specialCandidates: { id: string; weight: number; rarity: Rarity }[] = [];
        let specialTotalWeight = 0;
        let specialLegWeight = 0;

        // Agrupa os itens normais por raridade com seus pesos de rank
        const normalByRarity: Record<Rarity, { id: string; rankWeight: number }[]> = {
          COMMON: [],
          UNCOMMON: [],
          RARE: [],
          EPIC: [],
          LEGENDARY: [],
        };

        const isLegBlocked = weeklyLegMultiplier <= 0;

        for (const char of candidates) {
          // Se Lendários estiverem bloqueados nesta semana (hard cap atingido), ignora
          if (isLegBlocked && char.baseRarity === 'LEGENDARY' && !(char as any).isMythic) {
            continue;
          }

          const isWish = wishMap.has(char.id);
          const claimCount = claimedMap.get(char.id) ?? 0;
          const shares = investmentMap.get(char.id) ?? 0;

          const isMythic = Boolean((char as any).isMythic);
          const rankWeight = (char as any).rankWeight ?? calculateRollRankWeight(
            (char as any).rank,
            config.ROLL_RANK_MAX_DIFFICULTY,
            config.ROLL_RANK_REF_CUTOFF
          );

          if (isWish || claimCount > 0 || shares > 0 || isMythic) {
            const effectiveRarity: Rarity = isMythic ? 'RARE' : char.baseRarity;
            if (isLegBlocked && effectiveRarity === 'LEGENDARY') {
              continue;
            }
            const weight = calculateCharacterWeight({
              baseRarity: effectiveRarity,
              claimCount,
              totalActiveUsersOrClaims: totalClaims,
              isWishlisted: isWish,
              isStarWish: wishMap.get(char.id) ?? false,
              bonuses,
              investmentShares: shares,
              weeklyLegendaryMultiplier: effectiveRarity === 'LEGENDARY' ? weeklyLegMultiplier : undefined,
              rollRankWeight: rankWeight / config.ROLL_RANK_MAX_DIFFICULTY,
            });
            if (weight > 0) {
              specialCandidates.push({ id: char.id, weight, rarity: effectiveRarity });
              specialTotalWeight += weight;
              if (effectiveRarity === 'LEGENDARY') {
                specialLegWeight += weight;
              }
            }
          } else {
            normalByRarity[char.baseRarity].push({ id: char.id, rankWeight });
          }
        }

        // Calcula peso base por raridade considerando multiplicadores e diminishing returns
        const rarityWeights: Record<Rarity, number> = {
          COMMON: RARITY_BASE_WEIGHTS.COMMON * (bonuses?.rarityMultipliers?.COMMON ?? 1.0),
          UNCOMMON: RARITY_BASE_WEIGHTS.UNCOMMON * (bonuses?.rarityMultipliers?.UNCOMMON ?? 1.0),
          RARE: RARITY_BASE_WEIGHTS.RARE * (bonuses?.rarityMultipliers?.RARE ?? 1.0),
          EPIC: RARITY_BASE_WEIGHTS.EPIC * (bonuses?.rarityMultipliers?.EPIC ?? 1.0),
          LEGENDARY: isLegBlocked
            ? 0
            : RARITY_BASE_WEIGHTS.LEGENDARY * (bonuses?.rarityMultipliers?.LEGENDARY ?? 1.0) * weeklyLegMultiplier,
        };

        const normalTierWeights: { rarity: Rarity; totalWeight: number }[] = [];
        let normalTotalWeight = 0;
        let normalLegWeight = 0;

        for (const r of ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as Rarity[]) {
          const count = normalByRarity[r].length;
          if (count > 0 && (!isLegBlocked || r !== 'LEGENDARY')) {
            const tierWeight = count * rarityWeights[r];
            normalTierWeights.push({ rarity: r, totalWeight: tierWeight });
            normalTotalWeight += tierWeight;
            if (r === 'LEGENDARY') {
              normalLegWeight = tierWeight;
            }
          }
        }

        // Aplicação do Cap Máximo de Chance para Lendários (ex: 0.8% escalado proporcionalmente por diminishing returns)
        const currentLegWeight = specialLegWeight + normalLegWeight;
        const initialGrandTotal = specialTotalWeight + normalTotalWeight;
        const nonLegWeight = initialGrandTotal - currentLegWeight;
        const legCapFraction = isLegBlocked ? 0 : getLegendaryChanceCap() * weeklyLegMultiplier;

        if (nonLegWeight > 0 && currentLegWeight > 0 && legCapFraction < 1.0) {
          const currentLegFraction = currentLegWeight / initialGrandTotal;
          if (currentLegFraction > legCapFraction) {
            // targetLegWeight / (targetLegWeight + nonLegWeight) = legCapFraction
            const targetLegWeight = (legCapFraction / (1 - legCapFraction)) * nonLegWeight;
            const scaleFactor = targetLegWeight / currentLegWeight;

            specialTotalWeight -= specialLegWeight;
            specialLegWeight = 0;
            for (const item of specialCandidates) {
              if (item.rarity === 'LEGENDARY') {
                item.weight = Math.max(1, Math.round(item.weight * scaleFactor));
                specialLegWeight += item.weight;
              }
            }
            specialTotalWeight += specialLegWeight;

            normalTotalWeight -= normalLegWeight;
            const legTier = normalTierWeights.find((t) => t.rarity === 'LEGENDARY');
            if (legTier) {
              legTier.totalWeight = Math.max(1, Math.round(legTier.totalWeight * scaleFactor));
              normalLegWeight = legTier.totalWeight;
            } else {
              normalLegWeight = 0;
            }
            normalTotalWeight += normalLegWeight;
          }
        }

        const grandTotalWeight = specialTotalWeight + normalTotalWeight;
        const randomVal = Math.random() * grandTotalWeight;

        let chosenId: string;
        const special = randomVal < specialTotalWeight;

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
          while (true) {
            const candidate = tierList[Math.floor(Math.random() * tierList.length)];
            if (Math.random() * config.ROLL_RANK_MAX_DIFFICULTY <= candidate.rankWeight) {
              chosenId = candidate.id;
              break;
            }
          }
        }
        setAttrs({ 'waifu.roll.candidates': candidates.length, 'waifu.roll.special_candidates': specialCandidates.length }, span);
        return { chosenId, special };
      });
      if (!picked) {
        throw new Error('NO_CHARACTERS_AVAILABLE');
      }
      const { chosenId } = picked;

      // 6. Buscar detalhes completos apenas do personagem sorteado (+ JIT do Hub se faltar localmente)
      const chosen = await withSpan('roll candidate.load', {}, async () => {
        let chosen = await this.prisma.character.findUnique({
          where: { id: chosenId },
          include: {
            _count: { select: { wishlists: true } },
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

      // Se não encontrou no banco local e há UPSTREAM_API_URL configurada, busca e persiste JIT
      const jitFetch = !chosen && Boolean(config.UPSTREAM_API_URL);
      setAttrs({ 'waifu.roll.jit_fetch': jitFetch, 'waifu.roll.special': picked.special }, rollSpan);
      if (!chosen && config.UPSTREAM_API_URL) {
        const fetched = await this.characterService.findCharacter(chosenId);
        if (fetched) {
          chosen = await this.prisma.character.findUnique({
            where: { id: chosenId },
            include: {
              _count: { select: { wishlists: true } },
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
        }
      }

      return chosen;
      });

      if (!chosen) {
        throw new Error('CHOSEN_CHARACTER_NOT_FOUND');
      }

      setAttrs({ 'waifu.roll.rarity': chosen.isMythic ? 'MYTHIC' : chosen.baseRarity });

      // Personagens míticos funcionam como showcase e NÃO devem consumir roll do jogador
      if (chosen.isMythic && !isFreeRoll) {
        await this.cooldownService.refundRoll(userId, extraMaxRolls);
        rollsState = await this.cooldownService.getUserRolls(userId, extraMaxRolls);
        mythicRollRefunded = true;
      }

      // Buscar membros do grupo que têm esse personagem na wishlist
      const wishlistUsers = await withSpan('roll wishlist.group', {}, async () => {
        const groupWishlistEntries = groupId
          ? await this.prisma.wishlistEntry.findMany({
              where: {
                characterId: chosen.id,
                user: {
                  groups: {
                    some: { groupId },
                  },
                },
              },
              select: {
                userId: true,
                isStarWish: true,
                user: {
                  select: { id: true, name: true },
                },
              },
            })
          : [];

        const wishlistUsers = groupWishlistEntries.map((e) => ({
          userId: e.userId,
          name: e.user?.name || e.userId,
          isStarWish: e.isStarWish,
        }));

        // Garante que se o autor do roll tiver na wishlist, esteja presente na lista
        if (wishMap.has(chosen.id) && !wishlistUsers.some((u) => u.userId === userId)) {
          const roller = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true },
          });
          wishlistUsers.push({
            userId,
            name: roller?.name || userId,
            isStarWish: wishMap.get(chosen.id) ?? false,
          });
        }
        return wishlistUsers;
      });

      // 7. Processar estado de dono e recompensas
      const existingHaremEntry = chosen.haremEntries[0];
      const isOwner = existingHaremEntry?.userId === userId;
      const isClaimed = !!existingHaremEntry;

      let keyProgress = null;
      let kakeraCrystalValue: number | null = null;
      const rollerShares = investmentMap.get(chosen.id) ?? 0;
      let instantMarriage = false;
      let instantHaremEntry: any = null;
      let refundedCompetitorsCount = 0;
      let rollerUser = null as { id: string; name: string; kakera: number } | null; // atribuído dentro do span claim.process

      await withSpan('roll claim.process', { attributes: { 'waifu.roll.claimed': isClaimed } }, async () => {
        if (isClaimed) {
          if (isOwner) {
            if (chosen.isMythic) {
              // Personagens Míticos possuem devoção eterna e não acumulam chaves nem viram soulmate
              keyProgress = null;
            } else {
              // Dono rolou o próprio personagem -> +1 Key até o teto (SOULMATE_KEYS_REQUIRED)
              const maxKeys = config.SOULMATE_KEYS_REQUIRED;

              if (existingHaremEntry.keys >= maxKeys) {
                keyProgress = {
                  currentKeys: maxKeys,
                  requiredForSoulmate: maxKeys,
                  isSoulmate: true,
                  becameSoulmateNow: false,
                };
                setAttrs({ 'waifu.roll.key_capped': true });
              } else {
                const updated = await this.prisma.haremEntry.updateMany({
                  where: {
                    id: existingHaremEntry.id,
                    keys: { lt: maxKeys },
                  },
                  data: { keys: { increment: 1 } },
                });

                if (updated.count === 0) {
                  const latest = await this.prisma.haremEntry.findUnique({
                    where: { id: existingHaremEntry.id },
                    select: { keys: true },
                  });
                  const latestKeys = latest?.keys ?? maxKeys;
                  keyProgress = {
                    currentKeys: Math.min(latestKeys, maxKeys),
                    requiredForSoulmate: maxKeys,
                    isSoulmate: latestKeys >= maxKeys,
                    becameSoulmateNow: false,
                  };
                  setAttrs({ 'waifu.roll.key_capped': true });
                } else {
                  const updatedHarem = await this.prisma.haremEntry.findUnique({
                    where: { id: existingHaremEntry.id },
                    select: { keys: true },
                  });
                  const newKeys = updatedHarem?.keys ?? Math.min(maxKeys, existingHaremEntry.keys + 1);
                  let becameSoulmate = false;

                  if (newKeys >= maxKeys) {
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
                    requiredForSoulmate: maxKeys,
                    isSoulmate: newKeys >= maxKeys,
                    becameSoulmateNow: becameSoulmate && newKeys === maxKeys,
                  };
                }
              }
            }
          } else {
            // Outro usuário é dono -> cristal de kakera
            const crystalBase = KAKERA_CRYSTAL_BASE[chosen.baseRarity] ?? 10;
            const cappedKeys = Math.min(existingHaremEntry.keys, config.SOULMATE_KEYS_REQUIRED);
            kakeraCrystalValue = crystalBase + cappedKeys * KAKERA_CRYSTAL_KEY_BONUS;
          }
        } else if (rollerShares > 0) {
          // CASAMENTO INSTANTÂNEO POR COTA!
          // O usuário possuía ao menos 1 cota nesta waifu livre.
          // O casamento é realizado instantaneamente no próprio roll sem cooldown!
          instantMarriage = true;
          rollerUser = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, kakera: true },
          });

          const marryResult = await this.prisma.$transaction(async (tx) => {
            const entry = await tx.haremEntry.create({
              data: {
                userId,
                characterId: chosen.id,
                claimedInGroup: groupId || 'ROLL_COTA',
                keys: 1,
              },
            });

            await tx.character.update({
              where: { id: chosen.id },
              data: { claimCount: { increment: 1 } },
            });

            // Deleta o investimento do autor do roll
            await tx.characterInvestment.deleteMany({
              where: { characterId: chosen.id, userId },
            });

            // Estorna concorrentes (se houver)
            const competitors = await tx.characterInvestment.findMany({
              where: { characterId: chosen.id, userId: { not: userId } },
              include: { user: true },
            });

            for (const comp of competitors) {
              const refundAmount = Math.floor(comp.totalZinthos * COMPETITOR_INVESTMENT_REFUND_RATE);

              await tx.user.update({
                where: { id: comp.userId },
                data: { kakera: { increment: refundAmount } },
              });

              await tx.kakeraTransaction.create({
                data: {
                  userId: comp.userId,
                  amount: refundAmount,
                  reason: 'MARKET_REFUND',
                  metadata: {
                    type: 'INVESTMENT_ROLL_CLAIM_REFUND',
                    characterId: chosen.id,
                    characterName: chosen.name,
                    sharesLost: comp.shares,
                    totalInvested: comp.totalZinthos,
                    refundRate: 0.5,
                    marriedUserId: userId,
                  },
                },
              });
            }

            if (competitors.length > 0) {
              await tx.characterInvestment.deleteMany({
                where: { characterId: chosen.id, userId: { not: userId } },
              });
            }

            return { entry, refundedCount: competitors.length };
          });

          instantHaremEntry = marryResult.entry;
          refundedCompetitorsCount = marryResult.refundedCount;
          if (chosen.baseRarity === 'LEGENDARY') {
            await this.cooldownService.incrementWeeklyLegendary(userId, 1);
          }
        } else {
          // Livre comum: lock não exclusivo de 300 segundos (qualquer um do grupo pode casar)
          await this.cooldownService.setClaimLock(groupId, chosen.id, userId);
        }
      });

      // 8. Recompensa de Fragmentos de Zinthos por Roll
      const scrapRandom = Math.floor(Math.random() * (25 - 10 + 1)) + 10;
      const rawScrapRollBonus = Math.floor(rollsState.availableRolls * config.ROLL_SCRAP_BONUS_FACTOR);
      const scrapRollBonus = Math.min(config.ROLL_SCRAP_BONUS_CAP, rawScrapRollBonus);
      const scrapRollBonusCapped = rawScrapRollBonus > config.ROLL_SCRAP_BONUS_CAP;
      let rarityBonus = 0;
      if (chosen.baseRarity === 'RARE') rarityBonus = 35;
      else if (chosen.baseRarity === 'EPIC') rarityBonus = 100;
      else if (chosen.baseRarity === 'LEGENDARY') rarityBonus = 250;

      const baseScrap = scrapRandom + scrapRollBonus + rarityBonus;
      // Bônus proporcional da Wishlist: cada item na wishlist adiciona 1/1000 (+0.1%), dobrando o valor ao atingir 1000 itens (2.0x)
      const wishlistCount = wishlistRecords.length;
      const wishlistMultiplier = Math.min(2.0, 1 + wishlistCount / 1000);
      const totalScrap = Math.round(baseScrap * wishlistMultiplier);
      const wishlistScrapBonus = totalScrap - baseScrap;

      // Filhos begin/write/commit: o BEGIN/COMMIT da transação interativa não aparece nos `prisma *`.
      await withSpan('roll reward.apply', {}, () => withTxSpans('roll reward.apply', (inTx) => this.prisma.$transaction((tx) => inTx(async () => {
        await tx.user.update({
          where: { id: userId },
          data: { kakera: { increment: totalScrap } },
        });

        await tx.kakeraTransaction.create({
          data: {
            userId,
            amount: totalScrap,
            reason: 'ROLL_CRYSTAL',
            metadata: {
              characterId: chosen.id,
              rarity: chosen.baseRarity,
              baseScrap,
              scrapRandom,
              scrapRollBonus,
              scrapRollBonusRaw: rawScrapRollBonus,
              scrapRollBonusCapped,
              rarityBonus,
              wishlistCount,
              wishlistMultiplier,
              wishlistScrapBonus,
              availableRolls: rollsState.availableRolls,
            },
          },
        });
      }))));

      const now = Date.now();
      const lockExpiresAt = !isClaimed && !instantMarriage ? new Date(now + config.CLAIM_LOCK_SECONDS * 1000) : null;
      const nextRollAt = new Date(now + config.COOLDOWN_ROLL_SECONDS * 1000);

      return {
        success: true,
        data: {
          character: {
            id: chosen.id,
            numericId: (chosen as any).numericId ?? null,
            name: chosen.name,
            series: chosen.series,
            description: chosen.description,
            gender: chosen.gender,
            rarity: chosen.isMythic ? 'MYTHIC' : chosen.baseRarity,
            baseRarity: chosen.baseRarity,
            isMythic: Boolean(chosen.isMythic),
            mythicCustomization: chosen.mythicCustomization || null,
            imageUrl: this.characterService.getRandomImageUrl(chosen.id, chosen.imageUrls),
            imageUrls: chosen.imageUrls.map((img) => this.characterService.formatImageUrl(chosen.id, img)),
            tags: chosen.tags,
            likeCount: chosen.likeCount,
            claimCount: chosen.claimCount,
            wishlistCount: (chosen as any)._count?.wishlists ?? 0,
          },
          isMythic: Boolean(chosen.isMythic),
          mythicRollRefunded,
          available: !isClaimed && !instantMarriage,
          isWishlist: wishMap.has(chosen.id),
          isStarWish: wishMap.get(chosen.id) ?? false,
          wishlistUsers,
          isOwner: isOwner || instantMarriage,
          owner: isClaimed
            ? {
                id: existingHaremEntry.user.id,
                name: existingHaremEntry.user.name,
              }
            : instantMarriage
              ? {
                  id: userId,
                  name: rollerUser?.name || userId,
                }
              : null,
          instantMarriage,
          instantMarriageShares: rollerShares,
          refundedCompetitorsCount,
          keyProgress: instantMarriage ? { currentKeys: 1, requiredForSoulmate: config.SOULMATE_KEYS_REQUIRED, isSoulmate: false, becameSoulmateNow: false } : keyProgress,
          kakeraValue: kakeraCrystalValue,
          rollReward: {
            totalScrap,
            baseScrap,
            scrapRandom,
            scrapRollBonus,
            rarityBonus,
            wishlistBonus: wishlistScrapBonus,
            wishlistCount,
            wishlistMultiplier,
          },
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
          regenSeconds: rollsState.regenSeconds,
          dailyMarryLimit: {
            rarity: chosen.baseRarity,
            // Informativo: uma falha de Redis aqui não pode derrubar um roll já concluído (e estornar o roll)
            limitReached: await withSpan('roll daily_limit.check', {}, () =>
              this.cooldownService
                .canMarryDaily(userId, chosen.baseRarity, false)
                .then((r) => !r.allowed)
                .catch(() => false)
            ),
          },
        },
      };
    } catch (err: any) {
      // Estorna a tentativa caso haja falha não recuperável (apenas se não for free roll e se o roll
      // ainda não tiver sido estornado pela regra do Mítico — senão o jogador ganharia um roll grátis)
      if (!isFreeRoll && !mythicRollRefunded) {
        await this.cooldownService.refundRoll(userId, extraMaxRolls);
        addEvent('cooldown.refunded');
      }
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
