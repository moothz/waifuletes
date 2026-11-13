import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Rarity } from '@prisma/client';
import { CooldownService, RARITY_CLAIM_COOLDOWNS, ALL_RARITIES } from '../src/services/CooldownService.js';
import { config } from '../src/config.js';

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

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) deleted++;
    }
    return deleted;
  }

  async incrbyfloat(key: string, amount: number): Promise<string> {
    const item = this.store.get(key);
    const now = Date.now();
    let current = 0;
    let expiresAt = Infinity;
    if (item && item.expiresAt > now) {
      current = parseFloat(item.val) || 0;
      expiresAt = item.expiresAt;
    }
    const next = current + amount;
    this.store.set(key, { val: next.toString(), expiresAt });
    return next.toString();
  }

  async incrby(key: string, amount: number): Promise<number> {
    const item = this.store.get(key);
    const now = Date.now();
    let current = 0;
    let expiresAt = Infinity;
    if (item && item.expiresAt > now) {
      current = parseInt(item.val, 10) || 0;
      expiresAt = item.expiresAt;
    }
    const next = current + amount;
    this.store.set(key, { val: next.toString(), expiresAt });
    return next;
  }

  /**
   * Emula o INCR_WITH_TTL_LUA do CooldownService (incremento com piso em zero e TTL atômico).
   */
  async eval(_script: string, _numKeys: number, key: string, delta: string, ttl: string, isFloat: string): Promise<string> {
    const item = this.store.get(key);
    const now = Date.now();
    const alive = item && item.expiresAt > now;
    const current = alive ? parseFloat(item!.val) || 0 : 0;
    let next = Math.max(0, current + Number(delta));
    if (isFloat !== '1') next = Math.floor(next);
    const expiresAt = alive && item!.expiresAt !== Infinity ? item!.expiresAt : now + Number(ttl) * 1000;
    this.store.set(key, { val: next.toString(), expiresAt });
    return next.toString();
  }

  async expire(key: string, seconds: number): Promise<number> {
    const item = this.store.get(key);
    if (!item) return 0;
    item.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  pipeline() {
    const operations: Array<() => Promise<any>> = [];
    return {
      get: (key: string) => {
        operations.push(() => this.get(key));
        return this;
      },
      ttl: (key: string) => {
        operations.push(() => this.ttl(key));
        return this;
      },
      exec: async () => {
        const results = [];
        for (const op of operations) {
          try {
            const res = await op();
            results.push([null, res]);
          } catch (err) {
            results.push([err, null]);
          }
        }
        return results;
      },
    };
  }

  async quit(): Promise<void> {
    this.store.clear();
  }
}

describe('💍 Sistema de Cooldown de Casamento por Raridade (CooldownService)', () => {
  let redis: any;
  let cooldownService: CooldownService;
  const testUserId = 'user_rarity_test_123';

  beforeAll(() => {
    redis = new MockRedis();
    cooldownService = new CooldownService(redis);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await cooldownService.resetCooldown(testUserId, 'all');
  });

  it('deve ter as durações corretas configuradas para cada raridade', () => {
    expect(RARITY_CLAIM_COOLDOWNS.COMMON).toBe(1800); // 30 minutos
    expect(RARITY_CLAIM_COOLDOWNS.UNCOMMON).toBe(2700); // 45 minutos
    expect(RARITY_CLAIM_COOLDOWNS.RARE).toBe(3600); // 60 minutos
    expect(RARITY_CLAIM_COOLDOWNS.EPIC).toBe(5400); // 1h 30m
    expect(RARITY_CLAIM_COOLDOWNS.LEGENDARY).toBe(7200); // 2h (atual)
  });

  it('deve adquirir lock de COMMON e permitir adquirir UNCOMMON imediatamente sem bloqueio mútuo', async () => {
    // 1. Casamento com personagem Comum (30m)
    const acquiredCommon = await cooldownService.acquireClaimLock(testUserId, Rarity.COMMON);
    expect(acquiredCommon).toBe(true);

    // 2. Tentar casar novamente com Comum deve ser bloqueado
    const acquiredCommonAgain = await cooldownService.acquireClaimLock(testUserId, Rarity.COMMON);
    expect(acquiredCommonAgain).toBe(false);

    const commonCooldown = await cooldownService.getClaimCooldown(testUserId, Rarity.COMMON);
    expect(commonCooldown.active).toBe(true);
    expect(commonCooldown.remainingSeconds).toBeGreaterThan(1700);
    expect(commonCooldown.remainingSeconds).toBeLessThanOrEqual(1800);

    // 3. Casamento com personagem Incomum deve continuar permitido!
    const acquiredUncommon = await cooldownService.acquireClaimLock(testUserId, Rarity.UNCOMMON);
    expect(acquiredUncommon).toBe(true);

    const uncommonCooldown = await cooldownService.getClaimCooldown(testUserId, Rarity.UNCOMMON);
    expect(uncommonCooldown.active).toBe(true);
    expect(uncommonCooldown.remainingSeconds).toBeGreaterThan(2600);
    expect(uncommonCooldown.remainingSeconds).toBeLessThanOrEqual(2700);

    // 4. Casamento com Raro, Épico e Lendário ainda devem estar disponíveis
    const rareCooldown = await cooldownService.getClaimCooldown(testUserId, Rarity.RARE);
    expect(rareCooldown.active).toBe(false);

    const epicCooldown = await cooldownService.getClaimCooldown(testUserId, Rarity.EPIC);
    expect(epicCooldown.active).toBe(false);

    const legCooldown = await cooldownService.getClaimCooldown(testUserId, Rarity.LEGENDARY);
    expect(legCooldown.active).toBe(false);
  });

  it('getAllClaimCooldowns deve retornar o status de todas as 5 raridades', async () => {
    // Inicialmente tudo livre
    let state = await cooldownService.getAllClaimCooldowns(testUserId);
    expect(state.active).toBe(false);
    expect(state.remainingSeconds).toBe(0);
    expect(state.byRarity.COMMON.active).toBe(false);
    expect(state.byRarity.UNCOMMON.active).toBe(false);
    expect(state.byRarity.RARE.active).toBe(false);
    expect(state.byRarity.EPIC.active).toBe(false);
    expect(state.byRarity.LEGENDARY.active).toBe(false);

    // Coloca Épico em cooldown
    await cooldownService.acquireClaimLock(testUserId, Rarity.EPIC);

    state = await cooldownService.getAllClaimCooldowns(testUserId);
    expect(state.active).toBe(false); // ainda pode casar com outras raridades
    expect(state.byRarity.EPIC.active).toBe(true);
    expect(state.byRarity.EPIC.cooldownSeconds).toBe(5400);
    expect(state.byRarity.COMMON.active).toBe(false);

    // Bloqueia todas as raridades
    for (const r of ALL_RARITIES) {
      await cooldownService.acquireClaimLock(testUserId, r);
    }

    state = await cooldownService.getAllClaimCooldowns(testUserId);
    expect(state.active).toBe(true); // todas bloqueadas
    expect(state.remainingSeconds).toBeGreaterThan(0);
  });

  it('resetCooldown com raridade específica deve limpar apenas aquela raridade', async () => {
    await cooldownService.acquireClaimLock(testUserId, Rarity.COMMON);
    await cooldownService.acquireClaimLock(testUserId, Rarity.RARE);

    // Reseta apenas COMMON
    await cooldownService.resetCooldown(testUserId, 'claim', Rarity.COMMON);

    const commonCd = await cooldownService.getClaimCooldown(testUserId, Rarity.COMMON);
    expect(commonCd.active).toBe(false);

    const rareCd = await cooldownService.getClaimCooldown(testUserId, Rarity.RARE);
    expect(rareCd.active).toBe(true);
  });

  it('resetCooldown global (claim sem raridade) deve limpar todas as raridades', async () => {
    await cooldownService.acquireClaimLock(testUserId, Rarity.COMMON);
    await cooldownService.acquireClaimLock(testUserId, Rarity.RARE);
    await cooldownService.acquireClaimLock(testUserId, Rarity.LEGENDARY);

    await cooldownService.resetCooldown(testUserId, 'claim');

    const state = await cooldownService.getAllClaimCooldowns(testUserId);
    expect(state.active).toBe(false);
    expect(state.byRarity.COMMON.active).toBe(false);
    expect(state.byRarity.RARE.active).toBe(false);
    expect(state.byRarity.LEGENDARY.active).toBe(false);
  });

  it('deve respeitar chave legada ativa se o usuário já estiver em cooldown antes da migração', async () => {
    // Simula chave antiga definida antes do deploy
    await redis.set(`cooldown:claim:${testUserId}`, '1', 'EX', 3600);

    // Qualquer tentativa de lock deve ser recusada enquanto a chave legada existir
    const acquired = await cooldownService.acquireClaimLock(testUserId, Rarity.COMMON);
    expect(acquired).toBe(false);

    const cd = await cooldownService.getClaimCooldown(testUserId, Rarity.COMMON);
    expect(cd.active).toBe(true);
    expect(cd.remainingSeconds).toBeGreaterThan(0);
  });

  describe('📊 Limite Diário de Casamento & Trocas nos Classificados', () => {
    it('deve permitir casamentos até o limite diário configurado por raridade', async () => {
      // Épico: limite 10
      for (let i = 0; i < 9; i++) {
        const check = await cooldownService.canMarryDaily(testUserId, Rarity.EPIC, false);
        expect(check.allowed).toBe(true);
        await cooldownService.incrementDailyMarry(testUserId, Rarity.EPIC, 1.0);
      }

      // 10º casamento (atinge o limite)
      const check10 = await cooldownService.canMarryDaily(testUserId, Rarity.EPIC, false);
      expect(check10.allowed).toBe(true);
      await cooldownService.incrementDailyMarry(testUserId, Rarity.EPIC, 1.0);

      // 11º casamento deve ser bloqueado
      const check11 = await cooldownService.canMarryDaily(testUserId, Rarity.EPIC, false);
      expect(check11.allowed).toBe(false);
      expect(check11.reason).toContain('limite diário');
    });

    it('Lendário não deve ter limite diário para casamentos no roll', async () => {
      for (let i = 0; i < 20; i++) {
        const check = await cooldownService.canMarryDaily(testUserId, Rarity.LEGENDARY, false);
        expect(check.allowed).toBe(true);
      }
    });

    it('trocas no classificado contam 50% (0.5) e 0.5 arredonda para cima, mas permite !mu-casar', async () => {
      // Usuário faz 1 troca de waifu Rara (+0.5)
      await cooldownService.incrementDailyMarry(testUserId, Rarity.RARE, 0.5);

      const status = await cooldownService.getDailyMarryStatus(testUserId);
      expect(status.byRarity.RARE.used).toBe(0.5);
      expect(status.byRarity.RARE.effectiveUsed).toBe(1); // 0.5 conta como 1 (round-up)
      expect(status.byRarity.RARE.remaining).toBe(14); // 15 - 1 = 14

      // Casar pelo !mu-casar deve permitir
      const canMarry = await cooldownService.canMarryDaily(testUserId, Rarity.RARE, false);
      expect(canMarry.allowed).toBe(true);

      // Agora o usuário tem 9 casamentos e 1 troca em Épico (9.5 de 10)
      await cooldownService.resetCooldown(testUserId, 'claim', Rarity.EPIC);
      for (let i = 0; i < 9; i++) {
        await cooldownService.incrementDailyMarry(testUserId, Rarity.EPIC, 1.0);
      }
      await cooldownService.incrementDailyMarry(testUserId, Rarity.EPIC, 0.5); // 9.5 usado

      const epicStatus = await cooldownService.getDailyMarryStatus(testUserId);
      expect(epicStatus.byRarity.EPIC.used).toBe(9.5);
      expect(epicStatus.byRarity.EPIC.effectiveUsed).toBe(10); // round up

      // Se o jogador casar pelo !mu-casar DEVE permitir (pois 9.5 < 10)!
      const canMarryEpic = await cooldownService.canMarryDaily(testUserId, Rarity.EPIC, false);
      expect(canMarryEpic.allowed).toBe(true);

      // Ao realizar o casamento (+1.0), vai para 10.5 e agora sim bloqueia
      await cooldownService.incrementDailyMarry(testUserId, Rarity.EPIC, 1.0);
      const afterMarryEpic = await cooldownService.canMarryDaily(testUserId, Rarity.EPIC, false);
      expect(afterMarryEpic.allowed).toBe(false);
    });

    it('troca nos classificados para Lendária deve ter limite estrito de 10 por dia', async () => {
      // 10 trocas de Lendária permitidas
      for (let i = 0; i < 10; i++) {
        const canTrade = await cooldownService.canMarryDaily(testUserId, Rarity.LEGENDARY, true);
        expect(canTrade.allowed).toBe(true);
        await cooldownService.incrementDailyTrade(testUserId, Rarity.LEGENDARY, 1);
      }

      // 11ª troca de Lendária deve ser bloqueada
      const canTrade11 = await cooldownService.canMarryDaily(testUserId, Rarity.LEGENDARY, true);
      expect(canTrade11.allowed).toBe(false);
      expect(canTrade11.reason).toContain('10 Lendárias');

      // Mas o roll/casamento normal de Lendária continua livre sem limite!
      const canMarryNormal = await cooldownService.canMarryDaily(testUserId, Rarity.LEGENDARY, false);
      expect(canMarryNormal.allowed).toBe(true);
    });

    it('estornar um casamento que falhou libera só a trava de claim, sem zerar a cota diária', async () => {
      await cooldownService.incrementDailyMarry(testUserId, Rarity.COMMON, 1);
      await cooldownService.incrementDailyMarry(testUserId, Rarity.COMMON, 1);
      await cooldownService.incrementDailyTrade(testUserId, Rarity.LEGENDARY, 3);
      const acquired = await cooldownService.acquireClaimLock(testUserId, Rarity.COMMON, 600);
      expect(acquired).toBe(true);

      // Caminho usado pelo rollback do MarryService (corrida perdida, P2002 etc.)
      await cooldownService.releaseClaimCooldown(testUserId, Rarity.COMMON);

      expect(await cooldownService.getDailyMarryCount(testUserId, Rarity.COMMON)).toBe(2);
      expect(await cooldownService.getDailyTradeCount(testUserId, Rarity.LEGENDARY)).toBe(3);
      expect(await cooldownService.acquireClaimLock(testUserId, Rarity.COMMON, 600)).toBe(true);
    });

    it('contadores diários nunca ficam sem TTL nem negativos', async () => {
      await cooldownService.decrementDailyMarry(testUserId, Rarity.UNCOMMON, 5);
      expect(await cooldownService.getDailyMarryCount(testUserId, Rarity.UNCOMMON)).toBe(0);
      await cooldownService.incrementDailyMarry(testUserId, Rarity.UNCOMMON, 0.5);
      const ttl = await redis.ttl(`cooldown:daily:marry:${testUserId}:UNCOMMON`);
      expect(ttl).toBeGreaterThan(0);
    });
  });
});
