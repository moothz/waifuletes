import { PrismaClient, KakeraReason } from '@prisma/client';
import { CooldownService } from './CooldownService.js';
import { config } from '../config.js';
import { DomainError } from '../errors/DomainError.js';

export class KakeraService {
  constructor(
    private prisma: PrismaClient,
    private cooldownService: CooldownService
  ) {}

  async claimDaily(userId: string) {
    // 1. Reserva atômica do cooldown diário no Redis com SET ... NX
    const lockAcquired = await this.cooldownService.acquireDailyLock(userId);
    if (!lockAcquired) {
      const cooldown = await this.cooldownService.getDailyCooldown(userId);
      const hours = Math.floor(cooldown.remainingSeconds / 3600);
      const mins = Math.ceil((cooldown.remainingSeconds % 3600) / 60);
      return {
        success: false,
        error: {
          code: 'DAILY_COOLDOWN_ACTIVE',
          message: `Você já resgatou sua recompensa diária! Volte em ${hours > 0 ? `${hours}h ` : ''}${mins}min.`,
          remainingSeconds: cooldown.remainingSeconds,
          retryAfter: cooldown.retryAfter,
        },
      };
    }

    // 2. Consulta última transação de recompensa diária para calcular streak
    const lastDailyTx = await this.prisma.kakeraTransaction.findFirst({
      where: { userId, reason: 'DAILY_REWARD' },
      orderBy: { createdAt: 'desc' },
    });

    let currentStreak = 1;
    if (lastDailyTx) {
      const msSinceLast = Date.now() - new Date(lastDailyTx.createdAt).getTime();
      const hoursSinceLast = msSinceLast / (1000 * 3600);
      // Janela de combo: entre 20h e 40h desde o último resgate
      if (hoursSinceLast >= 20 && hoursSinceLast <= 40) {
        const prevMetadata = lastDailyTx.metadata as any;
        const prevStreak = typeof prevMetadata?.streak === 'number' ? prevMetadata.streak : 1;
        currentStreak = Math.min(7, prevStreak + 1);
      } else {
        currentStreak = 1;
      }
    }

    // Bônus percentual por dia de sequência:
    // Dia 1: 0%, Dia 2: 10%, Dia 3: 20%, Dia 4: 30%, Dia 5: 40%, Dia 6: 50%, Dia 7: 100%
    const streakBonusMap: Record<number, number> = {
      1: 0,
      2: 10,
      3: 20,
      4: 30,
      5: 40,
      6: 50,
      7: 100,
    };
    const bonusPercent = streakBonusMap[currentStreak] ?? 0;

    // Calcula recompensa diária com variância, bônus de streak e bônus da wishlist
    const variance = (Math.random() * 2 - 1) * config.DAILY_KAKERA_VARIANCE;
    const baseAmount = Math.max(100, Math.round(config.DAILY_KAKERA_AMOUNT + variance));
    const streakBonusAmount = Math.round(baseAmount * (bonusPercent / 100));

    // Bônus proporcional da Wishlist: cada item na wishlist adiciona 1/1000 (+0.1%), dobrando o valor ao atingir 1000 itens (2.0x)
    const wishlistCount = await this.prisma.wishlistEntry.count({ where: { userId } });
    const wishlistMultiplier = Math.min(2.0, 1 + wishlistCount / 1000);
    const wishlistBonusAmount = Math.round(baseAmount * (wishlistCount / 1000));

    const amount = baseAmount + streakBonusAmount + wishlistBonusAmount;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            kakera: { increment: amount },
          },
        });

        await tx.kakeraTransaction.create({
          data: {
            userId,
            amount,
            reason: 'DAILY_REWARD',
            metadata: {
              streak: currentStreak,
              baseAmount,
              streakBonusAmount,
              bonusPercent,
              wishlistCount,
              wishlistMultiplier,
              wishlistBonusAmount,
            },
          },
        });

        return updatedUser;
      });

      const nextDailyAt = new Date(Date.now() + config.COOLDOWN_DAILY_SECONDS * 1000);

      let msg = currentStreak > 1
        ? `Você recebeu ${amount} ${config.CURRENCY_NAME} ${config.CURRENCY_EMOJI}! 🔥 Sequência Diária: Dia ${currentStreak}/7 (+${bonusPercent}% bônus)!`
        : `Você recebeu ${amount} ${config.CURRENCY_NAME} ${config.CURRENCY_EMOJI}! Volte amanhã para manter sua sequência!`;

      if (wishlistBonusAmount > 0) {
        msg += ` 🌟 (+${wishlistBonusAmount} de Bônus Wishlist: ${wishlistCount}/1000)`;
      }

      return {
        success: true,
        data: {
          amount,
          baseAmount,
          streak: {
            current: currentStreak,
            bonusPercent,
            bonusAmount: streakBonusAmount,
            maxStreak: 7,
          },
          wishlist: {
            count: wishlistCount,
            bonusAmount: wishlistBonusAmount,
            multiplier: wishlistMultiplier,
          },
          currency: config.CURRENCY_NAME,
          currencyEmoji: config.CURRENCY_EMOJI,
          newBalance: result.kakera,
          nextDailyAt,
          message: msg,
        },
      };
    } catch (err) {
      // Em caso de falha na persistência, estorna o lock de cooldown diário
      await this.cooldownService.resetCooldown(userId, 'daily');
      throw err;
    }
  }

  async getBalance(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        kakera: true,
      },
    });

    if (!user) return null;

    return {
      userId: user.id,
      name: user.name,
      balance: user.kakera,
      currency: config.CURRENCY_NAME,
      currencyEmoji: config.CURRENCY_EMOJI,
    };
  }

  async getHistory(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [total, transactions] = await Promise.all([
      this.prisma.kakeraTransaction.count({ where: { userId } }),
      this.prisma.kakeraTransaction.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: transactions,
    };
  }

  async adminModifyKakera(params: {
    userId: string;
    amount: number;
    reason: KakeraReason;
    metadata?: any;
  }) {
    const { userId, amount, reason, metadata } = params;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new DomainError('USER_NOT_FOUND', 'Usuário não encontrado.', 404);
    }

    if (amount < 0) {
      // Débito atômico garantindo que kakera >= -amount
      const result = await this.prisma.$transaction(async (tx) => {
        const updateResult = await tx.user.updateMany({
          where: {
            id: userId,
            kakera: { gte: -amount },
          },
          data: {
            kakera: { increment: amount },
          },
        });

        if (updateResult.count === 0) {
          throw new DomainError('INSUFFICIENT_KAKERA', 'Saldo de Kakera insuficiente para realizar o débito.');
        }

        await tx.kakeraTransaction.create({
          data: {
            userId,
            amount,
            reason,
            metadata,
          },
        });

        const updated = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, kakera: true },
        });

        return updated!;
      });

      return {
        userId: result.id,
        newBalance: result.kakera,
        amountModified: amount,
      };
    }

    // Crédito normal
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          kakera: { increment: amount },
        },
      });

      await tx.kakeraTransaction.create({
        data: {
          userId,
          amount,
          reason,
          metadata,
        },
      });

      return updated;
    });

    return {
      userId: result.id,
      newBalance: result.kakera,
      amountModified: amount,
    };
  }
}
