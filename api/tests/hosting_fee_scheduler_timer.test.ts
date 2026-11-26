import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startHostingFeeScheduler } from '../src/jobs/hostingFeeScheduler.js';

const { runDailyFee } = vi.hoisted(() => ({ runDailyFee: vi.fn() }));

vi.mock('../src/services/HostingFeeService.js', () => ({
  HostingFeeService: class {
    runDailyFee = runDailyFee;
  },
}));

const DAY_MS = 24 * 3600 * 1000;

describe('hostingFeeScheduler — startHostingFeeScheduler', () => {
  let handle: { stop: () => void } | null = null;

  const start = () => {
    handle = startHostingFeeScheduler({ prisma: {} as any, redis: {} as any });
    return handle;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T06:59:00.000Z'));
    runDailyFee.mockReset();
    runDailyFee.mockResolvedValue({ date: '2026-11-26' });
  });

  afterEach(() => {
    handle?.stop();
    handle = null;
    vi.useRealTimers();
  });

  it('cobra às 07:00 UTC e não antes', async () => {
    start();

    await vi.advanceTimersByTimeAsync(60_000 - 1);
    expect(runDailyFee).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(runDailyFee).toHaveBeenCalledTimes(1);
    expect(new Date().toISOString()).toBe('2026-11-26T07:00:00.000Z');
  });

  it('rearma para o dia seguinte depois da cobrança', async () => {
    start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runDailyFee).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DAY_MS - 1);
    expect(runDailyFee).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(runDailyFee).toHaveBeenCalledTimes(2);
    expect(new Date().toISOString()).toBe('2026-11-27T07:00:00.000Z');
  });

  it('ALREADY_RAN não derruba o agendamento', async () => {
    runDailyFee.mockRejectedValueOnce(Object.assign(new Error('já foi executada'), { code: 'ALREADY_RAN' }));
    start();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runDailyFee).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(runDailyFee).toHaveBeenCalledTimes(2);
  });

  it('stop() cancela o timer', async () => {
    const scheduler = start();
    expect(vi.getTimerCount()).toBe(1);

    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(2 * DAY_MS);
    expect(runDailyFee).not.toHaveBeenCalled();
  });
});
