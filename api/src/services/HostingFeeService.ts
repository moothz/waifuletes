import { PrismaClient, Prisma, Rarity } from '@prisma/client';
import { Redis } from 'ioredis';
import { config, activeHostingRates, inactiveHostingRates } from '../config.js';
import { calculateDivorceRefund } from '../utils/rarityCalculator.js';
import { NotificationService } from './NotificationService.js';
import { DivorceService } from './DivorceService.js';

export interface DailyFeeSummary {
  date: string;
  totalUsersEvaluated: number;
  activeUsersCharged: number;
  inactiveUsersCharged: number;
  totalZinthosCollected: number;
  totalWaifusConfiscated: number;
  alreadyChargedToday: number;
  failedUsers: number;
  dryRun: boolean;
}

type CountByRarity = Record<Rarity, number>;

interface UserFeeResult {
  charged: boolean;
  alreadyCharged: boolean;
  isInactive: boolean;
  totalFee: number;
  debited: number;
  finalBalance: number;
  counts: CountByRarity;
  costs: Record<string, number>;
  waifusCount: number;
  confiscated: Array<{ id: string; name: string; rarity: string; recoveredValue: number }>;
}

const RARITY_PRIORITY: Record<Rarity, number> = {
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5,
};

const RARITY_LABEL: Record<Rarity, string> = {
  COMMON: 'Comum',
  UNCOMMON: 'Incomum',
  RARE: 'Raro',
  EPIC: 'Épico',
  LEGENDARY: 'Lendário',
};

const RUN_LOCK_TTL_SECONDS = 60 * 60; // trava de execução em andamento
const DONE_LOCK_TTL_SECONDS = 23 * 3600; // marca de "já executado hoje"
const TX_TIMEOUT_MS = 30_000;

export class HostingFeeService {
  constructor(
    private prisma: PrismaClient,
    private redis?: Redis,
    private notificationService?: NotificationService,
    private divorceService?: DivorceService
  ) {}

  /**
   * Executa a cobrança diária de taxa de hospedagem para todos os jogadores com harém.
   *
   * Garantias:
   * - Uma execução por vez (SET NX) e uma por dia, a menos que `force` seja usado.
   * - Idempotente por jogador e por dia: a cobrança registra `feeDate` nas transações de kakera e é
   *   pulada se já existir — mesmo com `force` ou após uma execução interrompida no meio.
   * - Saldo e harém são relidos dentro da transação com a linha do usuário travada (FOR UPDATE), e o
   *   débito é relativo (decrement), nunca uma gravação de saldo absoluto calculado fora da transação.
   * - Falha de um jogador não interrompe os demais.
   * - Personagens Míticos não pagam taxa nem são confiscados (assim como não podem ser divorciados).
   */
  async runDailyFee(options: { dryRun?: boolean; force?: boolean } = {}): Promise<DailyFeeSummary> {
    const { dryRun = false, force = false } = options;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const lockKey = `hosting:fee:lock:${dateStr}`;

    let holdsRunLock = false;
    if (this.redis && !dryRun) {
      const acquired = await this.redis.set(lockKey, 'running', 'EX', RUN_LOCK_TTL_SECONDS, 'NX');
      if (!acquired) {
        const state = await this.redis.get(lockKey);
        if (state === 'running') {
          throw new Error(`A taxa diária de hospedagem para ${dateStr} já está em execução.`);
        }
        if (!force) {
          throw new Error(`A taxa diária de hospedagem para a data ${dateStr} já foi executada.`);
        }
        // force: reexecução permitida; a idempotência por jogador evita cobrança em dobro
        await this.redis.set(lockKey, 'running', 'EX', RUN_LOCK_TTL_SECONDS);
      }
      holdsRunLock = true;
    }

    const summary: DailyFeeSummary = {
      date: dateStr,
      totalUsersEvaluated: 0,
      activeUsersCharged: 0,
      inactiveUsersCharged: 0,
      totalZinthosCollected: 0,
      totalWaifusConfiscated: 0,
      alreadyChargedToday: 0,
      failedUsers: 0,
      dryRun,
    };

    let completed = false;
    try {
      const graceMs = config.HOSTING_GRACE_HOURS * 3600 * 1000;
      const confiscoRatio = Math.max(0, Number(config.HOSTING_CONFISCO_PERMILLE ?? 3000)) / 10000;
      const inflationMultiplier = this.divorceService
        ? await this.divorceService.getInflationMultiplier().catch(() => 1.0)
        : 1.0;

      // Apenas a lista de candidatos; saldo e harém são relidos dentro da transação de cada jogador.
      const candidates = await this.prisma.user.findMany({
        where: { harem: { some: { character: { isMythic: false } } } },
        select: { id: true, kakera: true, lastActiveAt: true, updatedAt: true },
      });
      summary.totalUsersEvaluated = candidates.length;

      for (const candidate of candidates) {
        try {
          const result = await this.chargeUser(candidate.id, {
            now,
            dateStr,
            graceMs,
            confiscoRatio,
            inflationMultiplier,
            dryRun,
          });

          if (result.alreadyCharged) {
            summary.alreadyChargedToday++;
            continue;
          }
          if (!result.charged) continue;

          if (result.isInactive) summary.inactiveUsersCharged++;
          else summary.activeUsersCharged++;
          summary.totalZinthosCollected += result.debited;
          summary.totalWaifusConfiscated += result.confiscated.length;

          if (!dryRun) {
            await this.notifyUser(candidate.id, result).catch((err: any) => {
              console.error(`[HostingFee] Falha ao notificar ${candidate.id}:`, err?.message);
            });
          }
        } catch (err: any) {
          summary.failedUsers++;
          console.error(`[HostingFee] Falha ao cobrar ${candidate.id} (${dateStr}):`, err?.message || err);
        }
      }

      completed = true;
      return summary;
    } finally {
      if (this.redis && holdsRunLock) {
        if (completed) {
          await this.redis.set(lockKey, 'done', 'EX', DONE_LOCK_TTL_SECONDS).catch(() => {});
        } else {
          // Execução interrompida: libera para reexecutar (a idempotência por jogador protege quem já pagou)
          await this.redis.del(lockKey).catch(() => {});
        }
      }
    }
  }

  private async chargeUser(
    userId: string,
    ctx: {
      now: Date;
      dateStr: string;
      graceMs: number;
      confiscoRatio: number;
      inflationMultiplier: number;
      dryRun: boolean;
    }
  ): Promise<UserFeeResult> {
    const run = async (tx: Prisma.TransactionClient): Promise<UserFeeResult> => {
      // Trava a linha do usuário: serializa com outras operações de saldo durante a cobrança
      const locked = await tx.$queryRaw<Array<{ kakera: number; last_active_at: Date | null; updatedAt: Date }>>`
        SELECT kakera, last_active_at, "updatedAt" FROM users WHERE id = ${userId} FOR UPDATE
      `;
      const userRow = locked[0];
      const empty: UserFeeResult = {
        charged: false,
        alreadyCharged: false,
        isInactive: false,
        totalFee: 0,
        debited: 0,
        finalBalance: 0,
        counts: { COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 },
        costs: {},
        waifusCount: 0,
        confiscated: [],
      };
      if (!userRow) return empty;

      if (!ctx.dryRun) {
        const already = await tx.kakeraTransaction.findFirst({
          where: {
            userId,
            reason: { in: ['HOSTING_FEE', 'HOSTING_FEE_WAIFU'] },
            metadata: { path: ['feeDate'], equals: ctx.dateStr },
          },
          select: { id: true },
        });
        if (already) return { ...empty, alreadyCharged: true };
      }

      const harem = await tx.haremEntry.findMany({
        where: { userId, character: { isMythic: false } },
        select: {
          id: true,
          characterId: true,
          keys: true,
          claimedAt: true,
          character: { select: { id: true, name: true, baseRarity: true } },
        },
      });
      if (harem.length === 0) return empty;

      const lastActive = userRow.last_active_at ?? userRow.updatedAt;
      const isInactive = ctx.now.getTime() - new Date(lastActive).getTime() > ctx.graceMs;
      const rates = isInactive ? inactiveHostingRates : activeHostingRates;

      const counts: CountByRarity = { COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 };
      for (const entry of harem) counts[entry.character.baseRarity]++;
      const costs = {
        costCommon: counts.COMMON * rates.COMMON,
        costUncommon: counts.UNCOMMON * rates.UNCOMMON,
        costRare: counts.RARE * rates.RARE,
        costEpic: counts.EPIC * rates.EPIC,
        costLegendary: counts.LEGENDARY * rates.LEGENDARY,
      };
      const totalFee = Object.values(costs).reduce((a, b) => a + b, 0);
      if (totalFee <= 0) return { ...empty, counts, costs, waifusCount: harem.length };

      const balance = Math.max(0, Number(userRow.kakera) || 0);
      const base: UserFeeResult = {
        ...empty,
        charged: true,
        isInactive,
        totalFee,
        counts,
        costs,
        waifusCount: harem.length,
      };

      if (ctx.dryRun) {
        return { ...base, debited: Math.min(balance, totalFee), finalBalance: Math.max(0, balance - totalFee) };
      }

      const feeMeta = {
        feeDate: ctx.dateStr,
        isInactive,
        ratesUsed: rates,
        counts,
        costs,
        totalFee,
        waifusCount: harem.length,
      };

      if (balance >= totalFee) {
        const debited = await tx.user.updateMany({
          where: { id: userId, kakera: { gte: totalFee } },
          data: { kakera: { decrement: totalFee } },
        });
        if (debited.count !== 1) throw new Error('Saldo alterado durante a cobrança');
        await tx.kakeraTransaction.create({
          data: { userId, amount: -totalFee, reason: 'HOSTING_FEE', metadata: feeMeta as any },
        });
        return { ...base, debited: totalFee, finalBalance: balance - totalFee };
      }

      // Saldo insuficiente: debita o que há e quita o restante confiscando waifus (da menos valiosa)
      if (balance > 0) {
        const debited = await tx.user.updateMany({
          where: { id: userId, kakera: { gte: balance } },
          data: { kakera: { decrement: balance } },
        });
        if (debited.count !== 1) throw new Error('Saldo alterado durante a cobrança');
        await tx.kakeraTransaction.create({
          data: {
            userId,
            amount: -balance,
            reason: 'HOSTING_FEE',
            metadata: { ...feeMeta, partialDeduction: true, shortfall: totalFee - balance } as any,
          },
        });
      }

      const soulmates = await tx.soulmate.findMany({
        where: { userId, characterId: { in: harem.map((h) => h.characterId) } },
        select: { characterId: true },
      });
      const soulmateIds = new Set(soulmates.map((s) => s.characterId));
      const soulmateKeys = config.SOULMATE_KEYS_REQUIRED ?? 10;

      const sorted = [...harem].sort((a, b) => {
        const pA = RARITY_PRIORITY[a.character.baseRarity];
        const pB = RARITY_PRIORITY[b.character.baseRarity];
        if (pA !== pB) return pA - pB;
        return new Date(a.claimedAt).getTime() - new Date(b.claimedAt).getTime();
      });

      let remainingDebt = totalFee - balance;
      const confiscated: UserFeeResult['confiscated'] = [];

      for (const entry of sorted) {
        if (remainingDebt <= 0) break;

        const isSoulmate = entry.keys >= soulmateKeys || soulmateIds.has(entry.characterId);
        // Valor integral do divórcio (com soulmate e inflação, como no DivorceService), sem soft limit diário
        const refund = calculateDivorceRefund(entry.character.baseRarity, entry.keys, {
          isSoulmate,
          inflationMultiplier: ctx.inflationMultiplier,
          dailyDivorceRate: 1.0,
        });
        const recoveredValue = Math.max(1, Math.floor(refund.fullNetKakera * ctx.confiscoRatio));

        // Remove somente se a entrada ainda pertence a este jogador (não apaga waifu já trocada/vendida)
        const removed = await tx.haremEntry.deleteMany({ where: { id: entry.id, userId } });
        if (removed.count !== 1) continue;

        await tx.soulmate.deleteMany({ where: { userId, characterId: entry.characterId } });
        await tx.$executeRaw`
          UPDATE characters
          SET "claimCount" = GREATEST(0, "claimCount" - 1)
          WHERE id = ${entry.characterId}
        `;
        if (this.divorceService) {
          await this.divorceService.cancelCharacterListings(
            tx,
            userId,
            entry.characterId,
            'O personagem anunciado foi confiscado pela taxa de hospedagem.'
          );
        }

        const debtBefore = remainingDebt;
        remainingDebt -= recoveredValue;
        confiscated.push({
          id: entry.character.id,
          name: entry.character.name,
          rarity: entry.character.baseRarity,
          recoveredValue,
        });

        await tx.kakeraTransaction.create({
          data: {
            userId,
            amount: recoveredValue,
            reason: 'HOSTING_FEE_WAIFU',
            metadata: {
              feeDate: ctx.dateStr,
              characterId: entry.character.id,
              characterName: entry.character.name,
              rarity: entry.character.baseRarity,
              isSoulmate,
              fullNetKakera: refund.fullNetKakera,
              confiscoRatio: ctx.confiscoRatio,
              recoveredValue,
              debtBefore,
              debtAfter: remainingDebt,
            },
          },
        });
      }

      // Se o confisco rendeu mais do que a dívida, a sobra volta ao saldo (relativo ao saldo travado)
      let finalBalance = 0;
      if (remainingDebt < 0) {
        const surplus = Math.abs(remainingDebt);
        await tx.user.update({ where: { id: userId }, data: { kakera: { increment: surplus } } });
        finalBalance = surplus;
      }

      return { ...base, debited: balance, finalBalance, confiscated };
    };

    if (ctx.dryRun) {
      return this.prisma.$transaction(run, { timeout: TX_TIMEOUT_MS });
    }
    return this.prisma.$transaction(run, { timeout: TX_TIMEOUT_MS, maxWait: 10_000 });
  }

  /**
   * Notificação enviada só depois do commit, com o valor realmente debitado e os confiscos.
   */
  private async notifyUser(userId: string, r: UserFeeResult): Promise<void> {
    if (!this.notificationService) return;

    const breakdownLines = (Object.keys(r.counts) as Rarity[])
      .filter((rar) => r.counts[rar] > 0)
      .map((rar) => {
        const costKey = `cost${rar.charAt(0)}${rar.slice(1).toLowerCase()}`;
        return `• ${r.counts[rar]}x ${RARITY_LABEL[rar]} (${r.costs[costKey] ?? 0}z)`;
      })
      .join(' | ');

    const partial = r.debited < r.totalFee;
    const title = r.isInactive
      ? `⚠️ Taxa de Inatividade: -${r.debited} Zinthos`
      : `🏠 Taxa de Hospedagem: -${r.debited} Zinthos`;
    const statusMsg = r.isInactive
      ? `Você está inativo há mais de ${config.HOSTING_GRACE_HOURS}h.`
      : `Hospedagem diária do seu harém (${r.waifusCount} waifus).`;

    let message = `${statusMsg} Taxa do dia: ${r.totalFee} Zinthos. Debitado do saldo: ${r.debited} Zinthos.\nDemonstrativo: ${breakdownLines}`;
    if (partial && r.confiscated.length > 0) {
      const lost = r.confiscated.map((c) => `${c.name} (${RARITY_LABEL[c.rarity as Rarity] ?? c.rarity}, +${c.recoveredValue}z)`).join(', ');
      message += `\nSaldo insuficiente: ${r.confiscated.length} waifu(s) confiscada(s) para quitar a diferença: ${lost}.`;
    } else if (partial) {
      message += `\nSaldo insuficiente e nenhuma waifu pôde ser confiscada: a diferença foi perdoada hoje.`;
    }
    message += `\nSaldo atual: ${r.finalBalance} Zinthos.`;

    await this.notificationService.createNotification({
      userId,
      type: 'SYSTEM',
      title,
      message,
      metadata: {
        totalFee: r.totalFee,
        debited: r.debited,
        isInactive: r.isInactive,
        breakdown: r.counts,
        costs: r.costs,
        confiscated: r.confiscated,
        newBalance: r.finalBalance,
      },
    });
  }
}
