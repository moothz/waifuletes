import { PrismaClient, Rarity, KakeraReason, OfferStatus } from '@prisma/client';
import { Redis } from 'ioredis';
import { DomainError } from '../errors/DomainError.js';
import { CharacterService } from './CharacterService.js';

export const BASE_DAILY_ZINTHOS = 30000;

export const RARITY_DAYS: Record<Rarity, number> = {
  COMMON: 15,
  UNCOMMON: 30,
  RARE: 60,
  EPIC: 100,
  LEGENDARY: 210,
};

export const BASE_MONEY_SUPPLY = 4000000; // M0 = 4M Zinthos
export const INFLATION_ALPHA = 0.5;

export const SCARCITY_BETA: Record<Rarity, number> = {
  COMMON: 1.0,
  UNCOMMON: 1.0,
  RARE: 1.5,
  EPIC: 1.5,
  LEGENDARY: 2.5,
};

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

    // 1. Massa monetária em circulação (M2)
    const kakeraSumResult = await this.prisma.user.aggregate({
      _sum: { kakera: true },
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
   * Consulta a cotação dinâmica de compra e cotas de um personagem
   */
  async getCharacterQuote(characterIdOrSlug: string) {
    const character = await this.characterService.findCharacter(characterIdOrSlug);
    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.');
    }

    const macro = await this.getMacroStats();
    const rarityInfo = macro.rarityStats[character.baseRarity];

    // Checa se já pertence a alguém
    const haremEntry = await this.prisma.haremEntry.findFirst({
      where: { characterId: character.id },
      include: { user: { select: { id: true, name: true } } },
    });

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
      },
      pricing: {
        days: rarityInfo.days,
        basePrice: rarityInfo.basePrice,
        dynamicPrice: rarityInfo.dynamicPrice,
        cotaPrice: rarityInfo.cotaPrice,
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
   * Realiza a compra de cotas (1 a 4) em um personagem livre
   */
  async invest(params: {
    userId: string;
    characterIdOrSlug: string;
    shares?: number;
    groupId?: string;
  }) {
    const rawShares = params.shares ?? 1;
    const requestedShares = Math.max(1, Math.min(4, Math.floor(rawShares)));

    const character = await this.characterService.findCharacter(params.characterIdOrSlug);
    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.');
    }

    // 1. Personagem já está casado?
    const existingClaim = await this.prisma.haremEntry.findFirst({
      where: { characterId: character.id },
      include: { user: { select: { id: true, name: true } } },
    });
    if (existingClaim) {
      throw new DomainError(
        'CHARACTER_ALREADY_CLAIMED',
        `Este personagem já pertence a ${existingClaim.user.name}. Apenas personagens livres podem receber investimentos.`
      );
    }

    // 2. Consulta o usuário
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
    });
    if (!user) {
      throw new DomainError('USER_NOT_FOUND', 'Usuário não cadastrado.');
    }

    // 3. Cotação atual
    const quote = await this.getCharacterQuote(character.id);
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

    // 5. Transação Atômica no PostgreSQL
    return await this.prisma.$transaction(async (tx) => {
      // Re-verificação anti race-condition de casamento simultâneo
      const claimCheck = await tx.haremEntry.findFirst({
        where: { characterId: character.id },
      });
      if (claimCheck) {
        throw new DomainError(
          'CHARACTER_ALREADY_CLAIMED',
          'O personagem foi adquirido por outro jogador durante a transação.'
        );
      }

      // Débito do Zinthos do usuário
      await tx.user.update({
        where: { id: params.userId },
        data: { kakera: { decrement: totalCost } },
      });

      // Registro de extrato de Zinthos
      await tx.kakeraTransaction.create({
        data: {
          userId: params.userId,
          amount: -totalCost,
          reason: KakeraReason.MARKET_BUY,
          metadata: {
            type: 'INVESTMENT_SHARE_PURCHASE',
            characterId: character.id,
            characterName: character.name,
            sharesBought: actualSharesToBuy,
            cotaPrice,
            totalPrice: quote.pricing.dynamicPrice,
          },
        },
      });

      const newShares = currentShares + actualSharesToBuy;

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

        // Estorno 100% integral dos concorrentes que investiram nesta waifu
        const competitors = await tx.characterInvestment.findMany({
          where: {
            characterId: character.id,
            userId: { not: params.userId },
          },
          include: { user: true },
        });

        const refundedCompetitors = [];
        for (const comp of competitors) {
          await tx.user.update({
            where: { id: comp.userId },
            data: { kakera: { increment: comp.totalZinthos } },
          });

          await tx.kakeraTransaction.create({
            data: {
              userId: comp.userId,
              amount: comp.totalZinthos,
              reason: KakeraReason.MARKET_REFUND,
              metadata: {
                type: 'INVESTMENT_OUTBID_REFUND',
                characterId: character.id,
                characterName: character.name,
                sharesLost: comp.shares,
                winnerUserId: params.userId,
              },
            },
          });

          refundedCompetitors.push({
            userId: comp.userId,
            name: comp.user.name,
            refundedZinthos: comp.totalZinthos,
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
          character: quote.character,
          sharesBought: actualSharesToBuy,
          totalShares: 4,
          cost: totalCost,
          remainingShares: 0,
          refundedCompetitors,
          newBalance: user.kakera - totalCost,
        };
      } else {
        // Aquisição de cotas parciais (1 a 3 cotas)
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
  }

  /**
   * Lista todos os investimentos ativos de um usuário
   */
  async getUserInvestments(userId: string) {
    const investments = await this.prisma.characterInvestment.findMany({
      where: { userId },
      include: {
        character: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const macro = await this.getMacroStats();

    return investments.map((inv) => {
      const formattedChar = this.formatCharacter(inv.character);
      const rarityInfo = macro.rarityStats[inv.character.baseRarity];
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
        cotaPriceCurrent: rarityInfo.cotaPrice,
        totalPriceCurrent: rarityInfo.dynamicPrice,
        boostPercent,
        remainingShares: 4 - inv.shares,
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
      };
    });
  }
}
