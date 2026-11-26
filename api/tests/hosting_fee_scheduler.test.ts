import { describe, it, expect, vi } from 'vitest';
import { nextDailyResetAt } from '../src/jobs/hostingFeeScheduler.js';
import { HostingFeeService } from '../src/services/HostingFeeService.js';

describe('hostingFeeScheduler — nextDailyResetAt', () => {
  it('agenda para hoje às 07:00 UTC (04:00 BRT) quando ainda não passou do horário', () => {
    const now = new Date('2026-11-26T05:30:00.000Z');
    const next = nextDailyResetAt(now, 7, 0);
    expect(next.toISOString()).toBe('2026-11-26T07:00:00.000Z');
  });

  it('agenda para amanhã às 07:00 UTC quando já passou das 07:00 UTC', () => {
    const now = new Date('2026-11-26T07:00:01.000Z');
    const next = nextDailyResetAt(now, 7, 0);
    expect(next.toISOString()).toBe('2026-11-27T07:00:00.000Z');
  });

  it('avança um dia quando está exatamente no horário do reset', () => {
    const now = new Date('2026-11-26T07:00:00.000Z');
    const next = nextDailyResetAt(now, 7, 0);
    expect(next.toISOString()).toBe('2026-11-27T07:00:00.000Z');
  });
});

describe('HostingFeeService — cobrança retroativa', () => {
  it('usa targetDate como createdAt, filtra claimedAt <= targetDate e preserva lastActiveAt nulo', async () => {
    const retroDate = new Date('2026-11-15T07:00:00.000Z');
    const oldUpdatedAt = new Date('2026-10-01T07:00:00.000Z');
    const haremFindMany = vi.fn().mockResolvedValue([
      {
        id: 'h1',
        characterId: 'c1',
        keys: 1,
        claimedAt: oldUpdatedAt,
        character: { id: 'c1', name: 'Waifu Antiga', baseRarity: 'COMMON' },
      },
    ]);
    const userUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txCreate = vi.fn().mockResolvedValue({ id: 'tx1' });
    const findFirst = vi.fn().mockResolvedValue(null);

    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          kakera: 5000,
          last_active_at: null,
          updatedAt: oldUpdatedAt,
          createdAt: oldUpdatedAt,
        },
      ]),
      kakeraTransaction: { findFirst, create: txCreate },
      haremEntry: { findMany: haremFindMany },
      user: { updateMany: userUpdateMany },
    };

    const prisma: any = {
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'u1' }]),
      },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    const service = new HostingFeeService(prisma);
    const summary = await service.runDailyFee({ targetDate: retroDate, skipNotifications: true });

    expect(summary.date).toBe('2026-11-15');
    expect(summary.inactiveUsersCharged).toBe(1);
    expect(haremFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          claimedAt: { lte: retroDate },
        }),
      })
    );
    expect(userUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastActiveAt: oldUpdatedAt,
        }),
      })
    );
    expect(txCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdAt: retroDate,
          reason: 'HOSTING_FEE',
          metadata: expect.objectContaining({ feeDate: '2026-11-15' }),
        }),
      })
    );
  });

  it('pula usuário criado após targetDate no modo retroativo', async () => {
    const retroDate = new Date('2026-11-10T07:00:00.000Z');
    const createdLater = new Date('2026-11-20T07:00:00.000Z');
    const haremFindMany = vi.fn();

    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          kakera: 5000,
          last_active_at: createdLater,
          updatedAt: createdLater,
          createdAt: createdLater,
        },
      ]),
      haremEntry: { findMany: haremFindMany },
    };

    const prisma: any = {
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u2' }]) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    const service = new HostingFeeService(prisma);
    const summary = await service.runDailyFee({ targetDate: retroDate, skipNotifications: true });

    expect(summary.activeUsersCharged).toBe(0);
    expect(summary.inactiveUsersCharged).toBe(0);
    expect(haremFindMany).not.toHaveBeenCalled();
  });
});
