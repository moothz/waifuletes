import { PrismaClient, Prisma, Rarity, ListingStatus, OfferStatus } from '@prisma/client';
import { Redis } from 'ioredis';
import { DomainError } from '../errors/DomainError.js';
import { calculateDivorceRefund, getDailyDivorceRate } from '../utils/rarityCalculator.js';
import { config } from '../config.js';
import { MarketInvestmentService, BASE_MONEY_SUPPLY, INFLATION_ALPHA } from './MarketInvestmentService.js';

export class DivorceService {
  constructor(
    private prisma: PrismaClient,
    private marketInvestmentService?: MarketInvestmentService,
    private redis?: Redis
  ) {}

  /**
   * Retorna informações sobre o ciclo de reset diário (04:00 BRT / 07:00 UTC)
   */
  getDailyCycleInfo(date: Date = new Date()): { currentCycleStart: Date; nextReset: Date; secondsUntilReset: number } {
    const resetHourUtc = config.DAILY_RESET_HOUR_UTC ?? 7;
    const resetMinuteUtc = config.DAILY_RESET_MINUTE_UTC ?? 0;
    const todayReset = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), resetHourUtc, resetMinuteUtc, 0, 0)
    );

    let currentCycleStart: Date;
    let nextReset: Date;

    if (date.getTime() < todayReset.getTime()) {
      nextReset = todayReset;
      currentCycleStart = new Date(todayReset.getTime() - 24 * 60 * 60 * 1000);
    } else {
      currentCycleStart = todayReset;
      nextReset = new Date(todayReset.getTime() + 24 * 60 * 60 * 1000);
    }

    const secondsUntilReset = Math.max(1, Math.ceil((nextReset.getTime() - date.getTime()) / 1000));
    return { currentCycleStart, nextReset, secondsUntilReset };
  }

  private dailyDivorceKey(userId: string, rarity: string): string {
    return `divorce:daily:${userId}:${rarity.toUpperCase()}`;
  }

  /**
   * Consulta a contagem diária de divórcios do usuário para uma determinada raridade.
   * Utiliza Redis prioritariamente; se indisponível ou em cache miss, recorre ao histórico em PostgreSQL.
   */
  async getDailyDivorceCount(userId: string, rarity: Rarity | string): Promise<number> {
    const normRarity = String(rarity).toUpperCase();
    const cycle = this.getDailyCycleInfo();

    if (this.redis) {
      try {
        const key = this.dailyDivorceKey(userId, normRarity);
        const val = await this.redis.get(key);
        if (val !== null) {
          return Math.max(0, parseInt(val, 10) || 0);
        }
      } catch {
        // Fallback para PostgreSQL caso o Redis falhe momentaneamente
      }
    }

    // Fallback: consulta auditoria de transações do PostgreSQL no ciclo diário atual
    try {
      const countResult = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count
        FROM kakera_transactions
        WHERE "userId" = ${userId}
          AND "reason" = 'DIVORCE'::"KakeraReason"
          AND "createdAt" >= ${cycle.currentCycleStart}
          AND UPPER(COALESCE(metadata->>'rarity', '')) = ${normRarity}
      `;
      const countFromDb = Number(countResult[0]?.count || 0);

      // Reabastece o Redis com o TTL até o reset
      if (this.redis) {
        try {
          const key = this.dailyDivorceKey(userId, normRarity);
          await this.redis.set(key, String(countFromDb), 'EX', cycle.secondsUntilReset);
        } catch {
          // Ignora falhas de escrita de cache
        }
      }

      return countFromDb;
    } catch {
      return 0;
    }
  }

  /**
   * Incrementa atomicamente a contagem diária de divórcio para a raridade no Redis
   */
  async incrementDailyDivorceCount(userId: string, rarity: Rarity | string): Promise<number> {
    const normRarity = String(rarity).toUpperCase();
    const cycle = this.getDailyCycleInfo();

    if (this.redis) {
      try {
        const key = this.dailyDivorceKey(userId, normRarity);
        const exists = await this.redis.exists(key);
        if (!exists) {
          const prior = await this.getDailyDivorceCount(userId, normRarity);
          const next = prior + 1;
          await this.redis.set(key, String(next), 'EX', cycle.secondsUntilReset);
          return next;
        }
        return await this.redis.incr(key);
      } catch {
        // Ignora erros de cache
      }
    }
    return 1;
  }

  /**
   * Remove (cancela) os anúncios ativos do personagem nos classificados quando o usuário perde a posse.
   * Mantém o histórico para auditoria: o status vai para CANCELLED, e as ofertas pendentes são
   * canceladas com notificação para os compradores no próximo roll (buyerNotifiedStatus).
   * Deve rodar dentro da mesma transação do divórcio para garantir consistência.
   */
  async cancelCharacterListings(
    tx: Prisma.TransactionClient,
    userId: string,
    characterId: string,
    cancelReason: string
  ): Promise<number> {
    const listings = await tx.marketListing.findMany({
      where: { userId, characterId, status: ListingStatus.ACTIVE },
      select: { id: true },
    });

    if (listings.length === 0) {
      return 0;
    }

    const listingIds = listings.map((l) => l.id);

    await tx.marketOffer.updateMany({
      where: { listingId: { in: listingIds }, status: OfferStatus.PENDING },
      data: {
        status: OfferStatus.CANCELLED,
        cancelReason,
        notifiedBuyer: false,
        buyerNotifiedStatus: 'CANCELLED',
      },
    });

    await tx.marketListing.updateMany({
      where: { id: { in: listingIds } },
      data: { status: ListingStatus.CANCELLED },
    });

    return listingIds.length;
  }

  async getInflationMultiplier(): Promise<number> {
    if (this.marketInvestmentService) {
      try {
        const stats = await this.marketInvestmentService.getMacroStats();
        return stats.inflationMultiplier || 1.0;
      } catch {
        // Fallback para cálculo direto se o serviço falhar
      }
    }

    try {
      const kakeraSumResult = await this.prisma.user.aggregate({
        _sum: { kakera: true },
        where: { id: { not: 'test_web_user_1' } },
      });
      const circulatingKakera = kakeraSumResult._sum.kakera ?? BASE_MONEY_SUPPLY;
      const ratioMoney = Math.max(1, circulatingKakera / BASE_MONEY_SUPPLY);
      return Number((1 + INFLATION_ALPHA * Math.log(ratioMoney)).toFixed(4));
    } catch {
      return 1.0;
    }
  }

  /**
   * Consulta a estimativa de reembolso de divórcio antes da confirmação
   */
  async previewDivorce(userId: string, characterId: string) {
    const haremEntry = await this.prisma.haremEntry.findFirst({
      where: {
        userId,
        OR: [
          { characterId },
          { character: { id: characterId.toLowerCase().trim() } },
          { character: { name: { equals: characterId.trim(), mode: 'insensitive' } } },
        ],
      },
      include: {
        character: true,
      },
    });

    if (!haremEntry) {
      throw new DomainError('CHARACTER_NOT_IN_HAREM', 'Você não possui este personagem no seu harém.');
    }

    const { character, keys } = haremEntry;
    if (character.isMythic) {
      throw new DomainError('CANNOT_DIVORCE_MYTHIC', 'Personagens Míticos são criações perpétuas e não podem ser divorciados no jogo tradicional.');
    }
    const soulmateRecord = await this.prisma.soulmate.findUnique({
      where: {
        userId_characterId: {
          userId,
          characterId: character.id,
        },
      },
    });

    const isSoulmate = keys >= (config.SOULMATE_KEYS_REQUIRED ?? 10) || Boolean(soulmateRecord);
    const inflationMultiplier = await this.getInflationMultiplier();

    // Soft Limite diário por raridade
    const previousDailyDivorces = await this.getDailyDivorceCount(userId, character.baseRarity);
    const projectedDivorceNumber = previousDailyDivorces + 1;
    const refundRate = getDailyDivorceRate(projectedDivorceNumber);
    const nextTierRefundRate = getDailyDivorceRate(projectedDivorceNumber + 1);

    const refund = calculateDivorceRefund(character.baseRarity, keys, {
      isSoulmate,
      inflationMultiplier,
      dailyDivorceRate: refundRate,
    });

    const cycle = this.getDailyCycleInfo();

    return {
      refundedKakera: refund.netKakera,
      fullRefundKakera: refund.fullNetKakera,
      rawValue: refund.rawValue,
      keysBonus: refund.keysBonus,
      baseValue: refund.baseValue,
      keysLost: keys - refund.remainingKeys,
      currentKeys: keys,
      isSoulmate,
      inflationMultiplier,
      dailyDivorceCount: previousDailyDivorces,
      divorceTier: projectedDivorceNumber,
      refundRate,
      refundRatePercent: `${Math.round(refundRate * 100)}%`,
      nextTierRefundRate,
      secondsUntilReset: cycle.secondsUntilReset,
      character: {
        id: character.id,
        name: character.name,
        rarity: character.baseRarity,
      },
    };
  }

  async divorce(userId: string, characterId: string) {
    // 1. Localizar o personagem (flexível)
    let haremEntry = await this.prisma.haremEntry.findFirst({
      where: {
        userId,
        OR: [
          { characterId },
          { character: { id: characterId.toLowerCase().trim() } },
          { character: { name: { equals: characterId.trim(), mode: 'insensitive' } } },
        ],
      },
      include: {
        character: true,
      },
    });

    if (!haremEntry) {
      return {
        success: false,
        error: {
          code: 'CHARACTER_NOT_IN_HAREM',
          message: 'Você não possui este personagem no seu harém.',
        },
      };
    }

    const { character, keys } = haremEntry;
    if (character.isMythic) {
      throw new DomainError('CANNOT_DIVORCE_MYTHIC', 'Personagens Míticos são criações perpétuas e não podem ser divorciados no jogo tradicional.');
    }

    // 2. Verificar se o personagem é Soulmate (10+ chaves ou na tabela soulmates)
    const soulmateRecord = await this.prisma.soulmate.findUnique({
      where: {
        userId_characterId: {
          userId,
          characterId: character.id,
        },
      },
    });

    const isSoulmate = keys >= (config.SOULMATE_KEYS_REQUIRED ?? 10) || Boolean(soulmateRecord);
    const inflationMultiplier = await this.getInflationMultiplier();

    // 3. Consultar Soft Limite diário por raridade
    const previousDailyDivorces = await this.getDailyDivorceCount(userId, character.baseRarity);
    const currentDivorceNumber = previousDailyDivorces + 1;
    const refundRate = getDailyDivorceRate(currentDivorceNumber);
    const nextTierRefundRate = getDailyDivorceRate(currentDivorceNumber + 1);

    // 4. Calcular reembolso de Kakera com penalidade base e taxa de soft limite
    const refund = calculateDivorceRefund(character.baseRarity, keys, {
      isSoulmate,
      inflationMultiplier,
      dailyDivorceRate: refundRate,
    });

    // 5. Executar transação atômica
    let cancelledListings = 0;

    const result = await this.prisma.$transaction(async (tx) => {
      // Remove do harém
      await tx.haremEntry.delete({
        where: { id: haremEntry.id },
      });

      // Remove de soulmate se existir vínculo
      if (soulmateRecord) {
        await tx.soulmate.delete({
          where: { id: soulmateRecord.id },
        });
      }

      // Apaga o anúncio do personagem nos classificados (o usuário não é mais o dono)
      cancelledListings = await this.cancelCharacterListings(
        tx,
        userId,
        character.id,
        'O divórcio encerrou o anúncio: o vendedor não possui mais este personagem.'
      );

      // Decrementa claimCount de forma segura evitando valores negativos
      await tx.$executeRaw`
        UPDATE characters
        SET "claimCount" = GREATEST(0, "claimCount" - 1)
        WHERE id = ${character.id}
      `;

      // Credita Kakera ao usuário
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          kakera: { increment: refund.netKakera },
        },
      });

      // Registra no extrato com metadados completos de soft limit
      await tx.kakeraTransaction.create({
        data: {
          userId,
          amount: refund.netKakera,
          reason: 'DIVORCE',
          metadata: {
            characterId: character.id,
            characterName: character.name,
            rarity: character.baseRarity,
            keysAccumulated: keys,
            rawValue: refund.rawValue,
            rawBeforeInflation: refund.rawBeforeInflation,
            inflationMultiplier,
            penaltyRate: '5%',
            isSoulmate,
            dailyDivorceNumber: currentDivorceNumber,
            refundRate,
            fullRefundKakera: refund.fullNetKakera,
            softLimitApplied: refundRate < 1.0,
          },
        },
      });

      return updatedUser;
    });

    // 6. Incrementa contador no Redis
    await this.incrementDailyDivorceCount(userId, character.baseRarity).catch(() => {});

    const cycle = this.getDailyCycleInfo();

    return {
      success: true,
      data: {
        message: isSoulmate
          ? `💖 Divórcio Dourado! Você se separou de ${character.name} (Soulmate). Recebeu ${refund.netKakera} ${config.CURRENCY_NAME} ${config.CURRENCY_EMOJI}! 💔`
          : `Você se divorciou de ${character.name}. Recebeu ${refund.netKakera} ${config.CURRENCY_NAME} ${config.CURRENCY_EMOJI}! 💔`,
        refundedKakera: refund.netKakera,
        fullRefundKakera: refund.fullNetKakera,
        keysLost: keys - refund.remainingKeys,
        newKakeraBalance: result.kakera,
        cancelledListings,
        isSoulmate,
        inflationMultiplier,
        dailyDivorceCount: currentDivorceNumber,
        refundRate,
        refundRatePercent: `${Math.round(refundRate * 100)}%`,
        nextTierRefundRate,
        secondsUntilReset: cycle.secondsUntilReset,
        character: {
          id: character.id,
          name: character.name,
          rarity: character.baseRarity,
        },
      },
    };
  }

  async forceDivorce(userId: string, characterId: string) {
    const haremEntry = await this.prisma.haremEntry.findFirst({
      where: {
        userId,
        OR: [
          { characterId },
          { character: { id: characterId.toLowerCase().trim() } },
          { character: { name: { equals: characterId.trim(), mode: 'insensitive' } } },
        ],
      },
    });

    if (!haremEntry) {
      return {
        success: false,
        error: {
          code: 'CHARACTER_NOT_IN_HAREM',
          message: `Personagem ${characterId} não está no harém de ${userId}.`,
        },
      };
    }

    let cancelledListings = 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.haremEntry.delete({
        where: { id: haremEntry.id },
      });

      await tx.soulmate.deleteMany({
        where: {
          userId,
          characterId: haremEntry.characterId,
        },
      });

      // Apaga o anúncio do personagem nos classificados (o usuário não é mais o dono)
      cancelledListings = await this.cancelCharacterListings(
        tx,
        userId,
        haremEntry.characterId,
        'O anúncio foi encerrado: o vendedor não possui mais este personagem.'
      );

      await tx.$executeRaw`
        UPDATE characters
        SET "claimCount" = GREATEST(0, "claimCount" - 1)
        WHERE id = ${haremEntry.characterId}
      `;
    });

    return {
      success: true,
      data: {
        message: `Personagem ${haremEntry.characterId} foi removido à força do harém de ${userId}.`,
        cancelledListings,
      },
    };
  }
}
