import { PrismaClient, Rarity, KakeraReason, OfferStatus } from '@prisma/client';
import { Redis } from 'ioredis';
import { DomainError } from '../errors/DomainError.js';
import { CharacterService } from './CharacterService.js';
import { config, ravenaMarketHeaders, cotaRarityDays, cotaScarcityBetas } from '../config.js';
import { calculateRankMultiplier, calculateCharacterSharePricing } from '../utils/rarityCalculator.js';
import { withBusinessSpan, chatIdAttr, userIdAttr, setAttrs } from '../telemetry.js';

export const BASE_DAILY_ZINTHOS = config.COTA_BASE_DAILY_ZINTHOS ?? 21000;

export const RARITY_DAYS: Record<Rarity, number> = cotaRarityDays;

export const BASE_MONEY_SUPPLY = 4000000; // M0 = 4M Zinthos
export const INFLATION_ALPHA = config.COTA_INFLATION_ALPHA ?? 0.25;

/**
 * Fração devolvida (arredondada para baixo) a quem tinha cotas de investimento num personagem quando outro
 * jogador casa com ele (sorteio, casamento ou compra por cotas). O resto é queimado.
 */
export const COMPETITOR_INVESTMENT_REFUND_RATE = 0.5;

export const SCARCITY_BETA: Record<Rarity, number> = cotaScarcityBetas;

export interface MacroStats {
  circulatingKakera: number;
  baseMoneySupply: number;
  inflationMultiplier: number;
  inflationPercent: number;
  scarcityMultipliers: Record<Rarity, number>;
  rarityStats: Record<
    Rarity,
    {
      total: number;
      claimed: number;
      available: number;
      percentageClaimed: number;
      scarcityMultiplier: number;
      days: number;
      basePrice: number;
      dynamicPrice: number;
      cotaPrice: number;
    }
  >;
  thirtyDaysStats: {
    tradedWaifus: number;
    tradedZinthos: number;
    acceptedOffersCount: number;
  };
  updatedAt: number;
}

export class MarketInvestmentService {
  constructor(
    private prisma: PrismaClient,
    private characterService: CharacterService,
    private redis?: Redis
  ) {}

  private formatCharacter(character: any) {
    if (!character) return character;
    const imageUrl = this.characterService.getRandomImageUrl(character.id, character.imageUrls);
    const imageUrls = (character.imageUrls || []).map((img: string) =>
      this.characterService.formatImageUrl(character.id, img)
    );
    return {
      ...character,
      imageUrl,
      imageUrls,
    };
  }

  /**
   * Obtém estatísticas macroeconômicas (M2, inflação, escassez por raridade e negociações dos últimos 30 dias)
   * Utiliza cache no Redis (60s) para garantir performance extrema.
   */
  async getMacroStats(): Promise<MacroStats> {
    const CACHE_KEY = 'market:macro_stats_v2';

    if (this.redis) {
      try {
        const cached = await this.redis.get(CACHE_KEY);
        if (cached) {
          return JSON.parse(cached) as MacroStats;
        }
      } catch {
        // Fallback para consulta direta se o Redis falhar
      }
    }

    // 1. Massa monetária em circulação (M2) - exclui usuário sintético de testes
    const kakeraSumResult = await this.prisma.user.aggregate({
      _sum: { kakera: true },
      where: {
        id: { not: 'test_web_user_1' },
      },
    });
    const circulatingKakera = kakeraSumResult._sum.kakera ?? BASE_MONEY_SUPPLY;

    // Fator de Inflação Monetária: I_M = 1 + alpha * ln(max(1, M / M0))
    const ratioMoney = Math.max(1, circulatingKakera / BASE_MONEY_SUPPLY);
    const inflationMultiplier = Number((1 + INFLATION_ALPHA * Math.log(ratioMoney)).toFixed(4));
    const inflationPercent = Number(((inflationMultiplier - 1) * 100).toFixed(2));

    // 2. Escassez por categoria
    const counts = await this.prisma.$queryRaw<{ baseRarity: Rarity; total: bigint; claimed: bigint }[]>`
      SELECT 
        c."baseRarity",
        COUNT(c.id)::bigint as total,
        COUNT(h.id)::bigint as claimed
      FROM "characters" c
      LEFT JOIN "harem_entries" h ON h."characterId" = c.id
      WHERE c."isActive" = true
      GROUP BY c."baseRarity"
    `;

    const countMap = new Map<Rarity, { total: number; claimed: number }>();
    for (const r of counts) {
      countMap.set(r.baseRarity, {
        total: Number(r.total),
        claimed: Number(r.claimed),
      });
    }

    const scarcityMultipliers: Record<Rarity, number> = {
      COMMON: 1.0,
      UNCOMMON: 1.0,
      RARE: 1.0,
      EPIC: 1.0,
      LEGENDARY: 1.0,
    };

    const rarityStats: any = {};

    const rarities: Rarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
    for (const r of rarities) {
      const data = countMap.get(r) || { total: 0, claimed: 0 };
      const total = data.total;
      const claimed = data.claimed;
      const available = Math.max(0, total - claimed);
      const ratio = total > 0 ? Math.min(0.99, claimed / total) : 0;
      const beta = SCARCITY_BETA[r] || 1.0;
      const scarcityMultiplier = Number(Math.pow(1 / (1 - ratio), beta).toFixed(4));
      scarcityMultipliers[r] = scarcityMultiplier;

      const days = RARITY_DAYS[r];
      const basePrice = days * BASE_DAILY_ZINTHOS;
      const dynamicPrice = Math.round(basePrice * inflationMultiplier * scarcityMultiplier);
      const cotaPrice = Math.round(dynamicPrice / 4);

      rarityStats[r] = {
        total,
        claimed,
        available,
        percentageClaimed: Number((ratio * 100).toFixed(2)),
        scarcityMultiplier,
        days,
        basePrice,
        dynamicPrice,
        cotaPrice,
      };
    }

    // 3. Negociações de anúncios nos últimos 30 dias
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const acceptedOffers = await this.prisma.marketOffer.findMany({
      where: {
        status: OfferStatus.ACCEPTED,
        updatedAt: { gte: thirtyDaysAgo },
      },
      select: {
        offeredItems: true,
      },
    });

    let tradedZinthos = 0;
    let tradedWaifus = acceptedOffers.length; // Cada anúncio aceito transferiu a waifu do anúncio
    for (const off of acceptedOffers) {
      const items = off.offeredItems as any;
      if (items?.zinthos) tradedZinthos += Number(items.zinthos) || 0;
      if (Array.isArray(items?.waifuIds)) tradedWaifus += items.waifuIds.length;
    }

    const result: MacroStats = {
      circulatingKakera,
      baseMoneySupply: BASE_MONEY_SUPPLY,
      inflationMultiplier,
      inflationPercent,
      scarcityMultipliers,
      rarityStats,
      thirtyDaysStats: {
        tradedWaifus,
        tradedZinthos,
        acceptedOffersCount: acceptedOffers.length,
      },
      updatedAt: Date.now(),
    };

    if (this.redis) {
      try {
        await this.redis.set(CACHE_KEY, JSON.stringify(result), 'EX', 60);
      } catch {
        // Ignora erro de escrita no cache
      }
    }

    return result;
  }

  /**
   * Obtém a posição (rank) do personagem dentro de sua categoria (raridade) e o multiplicador correspondente
   */
  async getCharacterRankMultiplier(
    character: {
      id: string;
      baseRarity: Rarity;
      rarityRank?: number | null;
      rank?: number | null;
      popularityScore?: number | null;
      claimCount?: number | null;
    },
    totalInRarity: number
  ): Promise<{ position: number; total: number; rankMultiplier: number }> {
    const total = Math.max(1, totalInRarity || 1000);
    let position = character.rarityRank ?? null;

    if (!position && typeof this.prisma?.$queryRaw === 'function') {
      try {
        const rarity = character.baseRarity;
        const countResult = await this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count
          FROM characters
          WHERE "baseRarity" = ${rarity}::"Rarity"
            AND "isActive" = true
            AND (
              (rank IS NOT NULL AND ${character.rank ?? null} IS NOT NULL AND rank < ${character.rank})
              OR (${character.rank ?? null} IS NULL AND rank IS NOT NULL)
              OR (
                (rank = ${character.rank ?? null} OR (rank IS NULL AND ${character.rank ?? null} IS NULL))
                AND "popularityScore" > ${character.popularityScore ?? 0}
              )
              OR (
                (rank = ${character.rank ?? null} OR (rank IS NULL AND ${character.rank ?? null} IS NULL))
                AND "popularityScore" = ${character.popularityScore ?? 0}
                AND "claimCount" > ${character.claimCount ?? 0}
              )
              OR (
                (rank = ${character.rank ?? null} OR (rank IS NULL AND ${character.rank ?? null} IS NULL))
                AND "popularityScore" = ${character.popularityScore ?? 0}
                AND "claimCount" = ${character.claimCount ?? 0}
                AND id < ${character.id}
              )
            )
        `;
        if (Array.isArray(countResult) && countResult[0] && countResult[0].count !== undefined) {
          position = Number(countResult[0].count) + 1;
        }
      } catch {
        position = null;
      }
    }

    if (!position || position < 1) {
      position = total;
    }

    const rankMultiplier = calculateRankMultiplier(position, total);
    return { position, total, rankMultiplier };
  }

  /**
   * Consulta a cotação dinâmica de compra e cotas de um personagem
   */
  async getCharacterQuote(characterIdOrSlug: string, userId?: string) {
    const character = await this.characterService.findCharacter(characterIdOrSlug);
    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.');
    }

    if (character.isMythic || (character as any).baseRarity === 'MYTHIC') {
      throw new DomainError('CANNOT_INVEST_MYTHIC', 'Personagens Míticos pertencem exclusivamente ao seu criador e não possuem cotação de mercado.');
    }

    const macro = await this.getMacroStats();
    const rarityInfo = macro.rarityStats[character.baseRarity];
    const { position: rarityPosition, rankMultiplier } = await this.getCharacterRankMultiplier(
      character as any,
      rarityInfo.total
    );

    // Checa se já pertence a alguém
    const haremEntry = await this.prisma.haremEntry.findFirst({
      where: { characterId: character.id },
      include: { user: { select: { id: true, name: true } } },
    });

    // Identificação de vínculo e regras para cônjuge/soulmate
    let isSoulmate = false;
    let isOwner = false;
    let canInvest = true;
    const currentKeys = haremEntry ? (haremEntry.keys ?? 1) : 0;
    const maxKeys = config.SOULMATE_KEYS_REQUIRED ?? 10;

    if (haremEntry) {
      if (userId && haremEntry.userId === userId) {
        isOwner = true;
        const soulmateRecord = await this.prisma.soulmate.findUnique({
          where: {
            userId_characterId: {
              userId,
              characterId: character.id,
            },
          },
        });
        isSoulmate = currentKeys >= maxKeys || Boolean(soulmateRecord);
        if (isSoulmate) {
          canInvest = false;
        }
      } else {
        canInvest = false;
      }
    }

    const sharePricing = calculateCharacterSharePricing({
      baseRarity: character.baseRarity,
      baseDynamicPrice: rarityInfo.dynamicPrice,
      scarcityMultiplier: rarityInfo.scarcityMultiplier,
      inflationMultiplier: macro.inflationMultiplier,
      rankMultiplier,
      isOwner,
      currentKeys,
    });

    const discountPercent = sharePricing.discountPercent;
    const quoteCotaPrice = sharePricing.cotaPrice;

    // Investimentos ativos no personagem
    const activeInvestments = await this.prisma.characterInvestment.findMany({
      where: { characterId: character.id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { shares: 'desc' },
    });

    const formattedChar = this.formatCharacter(character);

    return {
      character: {
        id: character.id,
        name: character.name,
        series: character.series,
        baseRarity: character.baseRarity,
        imageUrl: formattedChar.imageUrl,
        imageUrls: formattedChar.imageUrls,
        claimCount: character.claimCount,
        likeCount: character.likeCount,
        isClaimed: Boolean(haremEntry),
        owner: haremEntry ? { id: haremEntry.user.id, name: haremEntry.user.name } : null,
        isOwner,
        isSoulmate,
        currentKeys,
      },
      pricing: {
        days: rarityInfo.days,
        basePrice: rarityInfo.basePrice,
        dynamicPrice: sharePricing.dynamicPrice,
        cotaPrice: quoteCotaPrice,
        baseCotaPrice: sharePricing.baseCotaPrice,
        discountPercent,
        keyProgressionWeight: sharePricing.keyProgressionWeight,
        rankMultiplier,
        rarityPosition,
        canInvest,
        inflationMultiplier: macro.inflationMultiplier,
        inflationPercent: macro.inflationPercent,
        scarcityMultiplier: rarityInfo.scarcityMultiplier,
      },
      rarityStats: {
        total: rarityInfo.total,
        claimed: rarityInfo.claimed,
        available: rarityInfo.available,
        percentageClaimed: rarityInfo.percentageClaimed,
      },
      investments: activeInvestments.map((inv) => ({
        userId: inv.userId,
        userName: inv.user.name,
        shares: inv.shares,
        totalZinthos: inv.totalZinthos,
        percent: inv.shares * 25,
      })),
    };
  }

  /**
   * Realiza a compra de cotas (1 a 4) em um personagem livre ou casado (pelo cônjuge com 80% OFF)
   */
  async invest(params: {
    userId: string;
    characterIdOrSlug: string;
    shares?: number;
    groupId?: string;
  }) {
    return withBusinessSpan(
      'market invest',
      { 'waifu.user.id': userIdAttr(params.userId), 'waifu.group.id': chatIdAttr(params.groupId) },
      () => this.investImpl(params)
    );
  }

  private async investImpl(params: {
    userId: string;
    characterIdOrSlug: string;
    shares?: number;
    groupId?: string;
  }) {
    const rawShares = params.shares ?? 1;
    const requestedShares = Math.max(1, Math.min(4, Math.floor(rawShares)));
    const maxKeys = config.SOULMATE_KEYS_REQUIRED ?? 10;

    const character = await this.characterService.findCharacter(params.characterIdOrSlug);
    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.');
    }

    if (character.isMythic || (character as any).baseRarity === 'MYTHIC') {
      throw new DomainError('CANNOT_INVEST_MYTHIC', 'Personagens Míticos pertencem exclusivamente ao seu criador e não aceitam investimentos.');
    }

    // 1. Personagem já está casado?
    const existingClaim = await this.prisma.haremEntry.findFirst({
      where: { characterId: character.id },
      include: { user: { select: { id: true, name: true } } },
    });

    const isOwner = Boolean(existingClaim && existingClaim.userId === params.userId);

    if (existingClaim) {
      if (!isOwner) {
        throw new DomainError(
          'CHARACTER_ALREADY_CLAIMED',
          `Este personagem já pertence a ${existingClaim.user.name}. Apenas o cônjuge pode investir em personagens casados.`
        );
      }

      // Se for o dono, verifica se já é Soulmate
      const soulmateRecord = await this.prisma.soulmate.findUnique({
        where: {
          userId_characterId: {
            userId: params.userId,
            characterId: character.id,
          },
        },
      });

      if ((existingClaim.keys ?? 1) >= maxKeys || soulmateRecord) {
        throw new DomainError(
          'ALREADY_SOULMATE',
          'Este personagem já é sua Alma Gêmea (Soulmate). Não é possível adquirir mais cotas.'
        );
      }
    }

    // 2. Consulta o usuário
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
    });
    if (!user) {
      throw new DomainError('USER_NOT_FOUND', 'Usuário não cadastrado.');
    }

    // 3. Cotação atual (passando userId para aplicar regras de cônjuge)
    const quote = await this.getCharacterQuote(character.id, params.userId);
    const cotaPrice = quote.pricing.cotaPrice;

    // 4. Quantidade de cotas que o usuário já possui
    const existingInvestment = await this.prisma.characterInvestment.findUnique({
      where: {
        characterId_userId: {
          characterId: character.id,
          userId: params.userId,
        },
      },
    });

    const currentShares = existingInvestment?.shares ?? 0;
    if (currentShares >= 4) {
      throw new DomainError('ALREADY_ACQUIRED', 'Você já possui todas as 4 cotas deste personagem.');
    }

    const maxPurchasable = 4 - currentShares;
    const actualSharesToBuy = Math.min(requestedShares, maxPurchasable);
    const totalCost = actualSharesToBuy * cotaPrice;

    if (user.kakera < totalCost) {
      throw new DomainError(
        'INSUFFICIENT_KAKERA',
        `Saldo insuficiente. Você possui ${user.kakera.toLocaleString('pt-BR')} Zinthos, mas são necessários ${totalCost.toLocaleString('pt-BR')} Zinthos para adquirir ${actualSharesToBuy} cota(s).`
      );
    }

    setAttrs({
      'waifu.market.is_owner': isOwner,
      'waifu.market.shares_bought': actualSharesToBuy,
    });

    // 5. Transação Atômica no PostgreSQL
    const result = await this.prisma.$transaction(async (tx) => {
      if (!isOwner) {
        // Re-verificação anti race-condition de casamento simultâneo para personagens livres
        const claimCheck = await tx.haremEntry.findFirst({
          where: { characterId: character.id },
        });
        if (claimCheck) {
          throw new DomainError(
            'CHARACTER_ALREADY_CLAIMED',
            'O personagem foi adquirido por outro jogador durante a transação.'
          );
        }
      } else {
        // Re-verificação atômica dentro da transação para evitar corrida entre roll e compra de cotas
        const freshClaim = await tx.haremEntry.findUnique({
          where: { id: existingClaim!.id },
          select: { id: true, userId: true, keys: true },
        });
        const freshSoulmate = await tx.soulmate.findUnique({
          where: {
            userId_characterId: {
              userId: params.userId,
              characterId: character.id,
            },
          },
          select: { id: true },
        });

        if (!freshClaim || freshClaim.userId !== params.userId) {
          throw new DomainError(
            'CHARACTER_ALREADY_CLAIMED',
            'O personagem foi transferido durante a transação.'
          );
        }
        if ((freshClaim.keys ?? 1) >= maxKeys || freshSoulmate) {
          throw new DomainError(
            'ALREADY_SOULMATE',
            'Este personagem já é sua Alma Gêmea (Soulmate). Não é possível adquirir mais cotas.'
          );
        }
        if ((freshClaim.keys ?? 1) !== (existingClaim!.keys ?? 1)) {
          throw new DomainError(
            'CONCURRENT_KEY_UPDATE',
            'As chaves deste personagem foram atualizadas durante a compra. Tente novamente.'
          );
        }
      }

      const freshInvestment = await tx.characterInvestment.findUnique({
        where: {
          characterId_userId: {
            characterId: character.id,
            userId: params.userId,
          },
        },
        select: { id: true, shares: true },
      });
      if ((freshInvestment?.shares ?? 0) !== currentShares) {
        throw new DomainError(
          'CONCURRENT_INVESTMENT_CONFLICT',
          'Suas cotas neste personagem foram atualizadas por outra requisição. Tente novamente.'
        );
      }

      // Débito atômico do Zinthos do usuário
      const debitedUser = await tx.user.updateMany({
        where: { id: params.userId, kakera: { gte: totalCost } },
        data: { kakera: { decrement: totalCost } },
      });
      if (debitedUser.count === 0) {
        throw new DomainError(
          'INSUFFICIENT_KAKERA',
          'Saldo insuficiente durante a transação.'
        );
      }

      // Registro de extrato de Zinthos
      await tx.kakeraTransaction.create({
        data: {
          userId: params.userId,
          amount: -totalCost,
          reason: KakeraReason.MARKET_BUY,
          metadata: {
            type: isOwner ? 'MARRIED_SHARE_PURCHASE' : 'INVESTMENT_SHARE_PURCHASE',
            characterId: character.id,
            characterName: character.name,
            sharesBought: actualSharesToBuy,
            cotaPrice,
            totalPrice: quote.pricing.dynamicPrice,
            isOwner,
            currentKeys: quote.character.currentKeys,
            rankMultiplier: quote.pricing.rankMultiplier,
            keyProgressionWeight: quote.pricing.keyProgressionWeight,
            discountPercent: quote.pricing.discountPercent,
          },
        },
      });

      const newShares = currentShares + actualSharesToBuy;

      if (isOwner) {
        // CENÁRIO A: USUÁRIO JÁ É CASADO COM A WAIFU (EVOLUÇÃO DE CHAVES)
        if (newShares >= 4) {
          // 4 cotas completadas = +1 chave (limitado estritamente a maxKeys)!
          const keyUpdate = await tx.haremEntry.updateMany({
            where: {
              id: existingClaim!.id,
              userId: params.userId,
              keys: {
                lt: maxKeys,
                equals: existingClaim!.keys ?? 1,
              },
            },
            data: { keys: { increment: 1 } },
          });

          if (keyUpdate.count === 0) {
            throw new DomainError(
              'ALREADY_SOULMATE',
              'Este personagem já é sua Alma Gêmea (Soulmate) ou teve suas chaves alteradas. Não é possível adquirir mais cotas.'
            );
          }

          const updatedHarem = await tx.haremEntry.findUnique({
            where: { id: existingClaim!.id },
            select: { keys: true },
          });
          const finalKeys = updatedHarem?.keys ?? Math.min(maxKeys, (existingClaim!.keys ?? 1) + 1);

          // Zera cotas acumuladas deste ciclo
          if (existingInvestment) {
            await tx.characterInvestment.deleteMany({
              where: { id: existingInvestment.id },
            });
          }

          let becameSoulmate = false;
          if (finalKeys >= maxKeys) {
            await tx.soulmate.upsert({
              where: {
                userId_characterId: {
                  userId: params.userId,
                  characterId: character.id,
                },
              },
              create: {
                userId: params.userId,
                characterId: character.id,
              },
              update: {},
            });
            becameSoulmate = true;
          }

          return {
            acquired: false,
            isMarried: true,
            keyEarned: true,
            currentKeys: finalKeys,
            becameSoulmate,
            character: quote.character,
            sharesBought: actualSharesToBuy,
            totalShares: 0,
            cost: totalCost,
            remainingShares: 4,
            discountPercent: quote.pricing.discountPercent,
            newBalance: user.kakera - totalCost,
          };
        } else {
          // Cotas parciais em waifu casada (1 a 3 cotas)
          await tx.characterInvestment.upsert({
            where: {
              characterId_userId: {
                characterId: character.id,
                userId: params.userId,
              },
            },
            create: {
              characterId: character.id,
              userId: params.userId,
              shares: newShares,
              totalZinthos: totalCost,
            },
            update: {
              shares: newShares,
              totalZinthos: { increment: totalCost },
            },
          });

          return {
            acquired: false,
            isMarried: true,
            keyEarned: false,
            currentKeys: existingClaim!.keys,
            becameSoulmate: false,
            character: quote.character,
            sharesBought: actualSharesToBuy,
            totalShares: newShares,
            cost: totalCost,
            remainingShares: 4 - newShares,
            discountPercent: quote.pricing.discountPercent,
            newBalance: user.kakera - totalCost,
          };
        }
      }

      // CENÁRIO B: WAIFU LIVRE (COMPRA INICIAL OU CASAMENTO POR 4 COTAS)
      if (newShares >= 4) {
        // COMPRA DEFINITIVA / 4 COTAS ATINGIDAS!
        await tx.haremEntry.create({
          data: {
            userId: params.userId,
            characterId: character.id,
            claimedInGroup: params.groupId || 'MERCADO',
            keys: 1,
          },
        });

        await tx.character.update({
          where: { id: character.id },
          data: { claimCount: { increment: 1 } },
        });

        // Remove o investimento do comprador
        if (existingInvestment) {
          await tx.characterInvestment.delete({
            where: { id: existingInvestment.id },
          });
        }

        // Estorno de 50% dos concorrentes que investiram nesta waifu
        const competitors = await tx.characterInvestment.findMany({
          where: {
            characterId: character.id,
            userId: { not: params.userId },
          },
          include: { user: true },
        });

        const refundedCompetitors = [];
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
              reason: KakeraReason.MARKET_REFUND,
              metadata: {
                type: 'INVESTMENT_OUTBID_REFUND',
                characterId: character.id,
                characterName: character.name,
                sharesLost: comp.shares,
                totalInvested: comp.totalZinthos,
                refundRate: 0.5,
                winnerUserId: params.userId,
              },
            },
          });

          refundedCompetitors.push({
            userId: comp.userId,
            name: comp.user.name,
            refundedZinthos: refundAmount,
            shares: comp.shares,
          });
        }

        // Deleta todos os investimentos restantes desse personagem
        if (competitors.length > 0) {
          await tx.characterInvestment.deleteMany({
            where: {
              characterId: character.id,
              userId: { not: params.userId },
            },
          });
        }

        return {
          acquired: true,
          isMarried: false,
          keyEarned: false,
          character: quote.character,
          sharesBought: actualSharesToBuy,
          totalShares: 4,
          cost: totalCost,
          remainingShares: 0,
          refundedCompetitors,
          newBalance: user.kakera - totalCost,
        };
      } else {
        // Aquisição de cotas parciais em personagem livre (1 a 3 cotas)
        await tx.characterInvestment.upsert({
          where: {
            characterId_userId: {
              characterId: character.id,
              userId: params.userId,
            },
          },
          create: {
            characterId: character.id,
            userId: params.userId,
            shares: newShares,
            totalZinthos: totalCost,
          },
          update: {
            shares: newShares,
            totalZinthos: { increment: totalCost },
          },
        });

        const boostPercent = newShares === 1 ? 300 : newShares === 2 ? 900 : 2400;

        return {
          acquired: false,
          isMarried: false,
          keyEarned: false,
          character: quote.character,
          sharesBought: actualSharesToBuy,
          totalShares: newShares,
          cost: totalCost,
          remainingShares: 4 - newShares,
          boostPercent,
          newBalance: user.kakera - totalCost,
        };
      }
    });

    setAttrs({
      'waifu.market.key_earned': result.keyEarned,
      'waifu.market.became_soulmate': Boolean((result as any).becameSoulmate),
    });

    if (result.acquired && character.baseRarity === 'LEGENDARY') {
      fetch(`${config.RAVENA_API_URL}/api/market/notify-legendary-marriage`, {
        method: 'POST',
        headers: ravenaMarketHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          character: {
            id: character.id,
            name: character.name,
            series: character.series,
            rarity: character.baseRarity,
            imageUrl: quote.character.imageUrl,
          },
          userName: user.name || params.userId,
          acquisitionType: 'cotas',
        }),
        signal: AbortSignal.timeout(5000),
      }).catch((err) => {
        console.error('Falha ao notificar casamento lendário por cotas na Ravena:', err?.message || err);
      });
    }

    return result;
  }

  /**
   * Lista todos os investimentos ativos de um usuário
   */
  async getUserInvestments(userId: string) {
    const [investments, userHaremEntries] = await Promise.all([
      this.prisma.characterInvestment.findMany({
        where: { userId },
        include: {
          character: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.haremEntry.findMany({
        where: { userId },
        select: { characterId: true, keys: true },
      }),
    ]);

    const userHaremMap = new Map(userHaremEntries.map((h) => [h.characterId, h.keys]));
    const macro = await this.getMacroStats();

    return Promise.all(
      investments.map(async (inv) => {
        const formattedChar = this.formatCharacter(inv.character);
        const rarityInfo = macro.rarityStats[inv.character.baseRarity];
        const isMarried = userHaremMap.has(inv.character.id);
        const currentKeys = userHaremMap.get(inv.character.id) ?? 0;
        const { rankMultiplier } = await this.getCharacterRankMultiplier(
          inv.character as any,
          rarityInfo.total
        );
        const sharePricing = calculateCharacterSharePricing({
          baseRarity: inv.character.baseRarity,
          baseDynamicPrice: rarityInfo.dynamicPrice,
          scarcityMultiplier: rarityInfo.scarcityMultiplier,
          inflationMultiplier: macro.inflationMultiplier,
          rankMultiplier,
          isOwner: isMarried,
          currentKeys,
        });
        const boostPercent = inv.shares === 1 ? 300 : inv.shares === 2 ? 900 : 2400;

        return {
          id: inv.id,
          character: {
            id: inv.character.id,
            name: inv.character.name,
            series: inv.character.series,
            baseRarity: inv.character.baseRarity,
            imageUrl: formattedChar.imageUrl,
          },
          shares: inv.shares,
          percent: inv.shares * 25,
          totalZinthosInvested: inv.totalZinthos,
          cotaPriceCurrent: sharePricing.cotaPrice,
          baseCotaPrice: sharePricing.baseCotaPrice,
          totalPriceCurrent: sharePricing.dynamicPrice,
          boostPercent,
          remainingShares: 4 - inv.shares,
          isMarried,
          currentKeys,
          discountPercent: sharePricing.discountPercent,
          createdAt: inv.createdAt,
          updatedAt: inv.updatedAt,
        };
      })
    );
  }
}
