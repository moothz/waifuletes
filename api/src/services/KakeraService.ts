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
          code: 'COOLDOWN_ACTIVE',
          message: `Você já resgatou sua recompensa diária! Volte em ${hours > 0 ? `${hours}h ` : ''}${mins}min.`,
          remainingSeconds: cooldown.remainingSeconds,
          retryAfter: cooldown.retryAfter,
        },
      };
    }

    // Calcula recompensa diária com variância
    const variance = (Math.random() * 2 - 1) * config.DAILY_KAKERA_VARIANCE;
    const amount = Math.max(100, Math.round(config.DAILY_KAKERA_AMOUNT + variance));

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
          },
        });

        return updatedUser;
      });

      const nextDailyAt = new Date(Date.now() + config.COOLDOWN_DAILY_SECONDS * 1000);

      return {
        success: true,
        data: {
          amount,
          currency: config.CURRENCY_NAME,
          currencyEmoji: config.CURRENCY_EMOJI,
          newBalance: result.kakera,
          nextDailyAt,
          message: `Você recebeu ${amount} ${config.CURRENCY_NAME} ${config.CURRENCY_EMOJI}! Volte amanhã para mais!`,
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
