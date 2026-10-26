import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { CooldownService } from '../dist/services/CooldownService.js';
import { config } from '../dist/config.js';

class MockRedis {
  private store = new Map<string, { val: string; expiresAt: number }>();

  async set(key: string, val: string, ...args: any[]): Promise<'OK' | null> {
    let ex = 0;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'EX') ex = Number(args[i + 1]);
      if (args[i] === 'NX') nx = true;
    }
    const existing = this.store.get(key);
    const now = Date.now();
    if (existing && existing.expiresAt > now) {
      if (nx) return null;
    }
    const expiresAt = ex > 0 ? now + ex * 1000 : Infinity;
    this.store.set(key, { val, expiresAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return item.val;
  }

  async ttl(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item) return -2;
    const remainingMs = item.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.store.delete(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async quit(): Promise<void> {
    this.store.clear();
  }
}

describe('⏰ Reset Diário Fixo às 04:00 BRT (Daily Cycle)', () => {
  let redis: any;
  let cooldownService: CooldownService;

  beforeAll(() => {
    redis = new MockRedis();
    cooldownService = new CooldownService(redis);
  });

  afterAll(async () => {
    await redis.quit();
  });

  describe('Cálculo do Ciclo Diário (getDailyCycleInfo)', () => {
    it('deve calcular próximo reset para o mesmo dia se o horário for antes das 04:00 BRT (07:00 UTC)', () => {
      // 03:00 BRT de 19/10/2026 = 06:00:00 UTC de 19/10/2026
      const beforeReset = new Date(Date.UTC(2026, 9, 19, 6, 0, 0, 0));
      const cycle = cooldownService.getDailyCycleInfo(beforeReset);

      // Próximo reset deve ser hoje às 07:00 UTC (04:00 BRT)
      expect(cycle.nextReset.toISOString()).toBe('2026-10-19T07:00:00.000Z');
      // Ciclo atual começou ontem às 07:00 UTC (04:00 BRT)
      expect(cycle.currentCycleStart.toISOString()).toBe('2026-10-18T07:00:00.000Z');
      // Ciclo anterior começou anteontem às 07:00 UTC
      expect(cycle.previousCycleStart.toISOString()).toBe('2026-10-17T07:00:00.000Z');
      // Segundos restantes até as 07:00 UTC = 3600 (1 hora)
      expect(cycle.secondsUntilReset).toBe(3600);
    });

    it('deve calcular próximo reset para o dia seguinte se o horário for após as 04:00 BRT (07:00 UTC)', () => {
      // 12:00 BRT de 19/10/2026 = 15:00:00 UTC de 19/10/2026
      const afterReset = new Date(Date.UTC(2026, 9, 19, 15, 0, 0, 0));
      const cycle = cooldownService.getDailyCycleInfo(afterReset);

      // Próximo reset deve ser amanhã às 07:00 UTC (04:00 BRT)
      expect(cycle.nextReset.toISOString()).toBe('2026-10-20T07:00:00.000Z');
      // Ciclo atual começou hoje às 07:00 UTC (04:00 BRT)
      expect(cycle.currentCycleStart.toISOString()).toBe('2026-10-19T07:00:00.000Z');
      // Ciclo anterior começou ontem às 07:00 UTC
      expect(cycle.previousCycleStart.toISOString()).toBe('2026-10-18T07:00:00.000Z');
      // Segundos restantes: 16 horas = 16 * 3600 = 57600
      expect(cycle.secondsUntilReset).toBe(57600);
    });

    it('deve virar o ciclo exatamente às 04:00:00 BRT (07:00:00 UTC)', () => {
      // Exatamente 07:00:00 UTC
      const exactReset = new Date(Date.UTC(2026, 9, 19, 7, 0, 0, 0));
      const cycle = cooldownService.getDailyCycleInfo(exactReset);

      expect(cycle.currentCycleStart.toISOString()).toBe('2026-10-19T07:00:00.000Z');
      expect(cycle.nextReset.toISOString()).toBe('2026-10-20T07:00:00.000Z');
      expect(cycle.secondsUntilReset).toBe(86400); // 24 horas
    });
  });

  describe('Integração com Redis (Lock & TTL Dinâmico)', () => {
    const testUserId = `test_daily_user_${Date.now()}`;

    afterAll(async () => {
      await cooldownService.resetCooldown(testUserId, 'daily');
    });

    it('acquireDailyLock deve definir TTL expirando às 04:00 do ciclo seguinte', async () => {
      const cycle = cooldownService.getDailyCycleInfo();
      const acquired = await cooldownService.acquireDailyLock(testUserId);
      expect(acquired).toBe(true);

      const cooldown = await cooldownService.getDailyCooldown(testUserId);
      expect(cooldown.active).toBe(true);
      expect(cooldown.remainingSeconds).toBeGreaterThan(0);
      expect(cooldown.remainingSeconds).toBeLessThanOrEqual(cycle.secondsUntilReset);

      // Segunda tentativa de lock deve falhar imediatamente
      const secondAttempt = await cooldownService.acquireDailyLock(testUserId);
      expect(secondAttempt).toBe(false);
    });

    it('resetCooldown deve liberar o lock diário com sucesso', async () => {
      await cooldownService.resetCooldown(testUserId, 'daily');
      const cooldown = await cooldownService.getDailyCooldown(testUserId);
      expect(cooldown.active).toBe(false);
      expect(cooldown.remainingSeconds).toBe(0);
    });
  });

  describe('Lógica de Streak por Ciclos Diários', () => {
    function computeStreak(
      lastTxDate: Date | null,
      prevStreak: number,
      nowDate: Date
    ): number {
      const cycleInfo = cooldownService.getDailyCycleInfo(nowDate);
      if (!lastTxDate) return 1;
      const txTime = lastTxDate.getTime();
      if (txTime >= cycleInfo.previousCycleStart.getTime() && txTime < cycleInfo.currentCycleStart.getTime()) {
        return Math.min(7, prevStreak + 1);
      }
      return 1;
    }

    it('deve incrementar o streak se a última coleta foi no ciclo anterior (mesmo com poucas horas de intervalo)', () => {
      // Usuário coletou às 23:00 de 19/10 (Ciclo: 19/10 04:00 -> 20/10 04:00)
      const lastTx = new Date(Date.UTC(2026, 9, 20, 2, 0, 0, 0)); // 23:00 BRT
      // Usuário coleta às 04:05 de 20/10 (Ciclo: 20/10 04:00 -> 21/10 04:00)
      const now = new Date(Date.UTC(2026, 9, 20, 7, 5, 0, 0)); // 04:05 BRT

      const streak = computeStreak(lastTx, 1, now);
      expect(streak).toBe(2);
    });

    it('deve incrementar o streak se a última coleta foi cedo ontem e agora tarde hoje (>36h de intervalo)', () => {
      // Coletou às 04:05 de 19/10
      const lastTx = new Date(Date.UTC(2026, 9, 19, 7, 5, 0, 0));
      // Coleta às 23:55 de 20/10 (~43h depois, mas em dias/ciclos consecutivos!)
      const now = new Date(Date.UTC(2026, 9, 21, 2, 55, 0, 0));

      const streak = computeStreak(lastTx, 3, now);
      expect(streak).toBe(4);
    });

    it('deve limitar streak ao máximo de 7', () => {
      const lastTx = new Date(Date.UTC(2026, 9, 20, 2, 0, 0, 0));
      const now = new Date(Date.UTC(2026, 9, 20, 7, 5, 0, 0));

      const streak = computeStreak(lastTx, 7, now);
      expect(streak).toBe(7);
    });

    it('deve resetar o streak para 1 se o jogador pulou um ciclo', () => {
      // Coletou no dia 18/10 às 10:00 BRT
      const lastTx = new Date(Date.UTC(2026, 9, 18, 13, 0, 0, 0));
      // Não coletou no ciclo de 19/10; tenta coletar no ciclo de 20/10 às 10:00 BRT
      const now = new Date(Date.UTC(2026, 9, 20, 13, 0, 0, 0));

      const streak = computeStreak(lastTx, 5, now);
      expect(streak).toBe(1);
    });
  });
});
