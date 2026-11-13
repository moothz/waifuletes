import { Redis } from 'ioredis';
import { Rarity } from '@prisma/client';
import { config } from '../config.js';

export interface UserRollsState {
  availableRolls: number;
  maxRolls: number;
  secondsToNext: number;
  fullRechargeSeconds: number;
  fullRechargeAt: Date;
  regenSeconds: number;
}

export interface DailyCycleInfo {
  previousCycleStart: Date;
  currentCycleStart: Date;
  nextReset: Date;
  secondsUntilReset: number;
}

export interface ClaimCooldownByRarity {
  active: boolean;
  remainingSeconds: number;
  retryAfter?: Date;
  cooldownSeconds: number;
}

export interface UserClaimCooldownState {
  active: boolean;
  remainingSeconds: number;
  retryAfter?: Date;
  byRarity: Record<Rarity, ClaimCooldownByRarity>;
}

export const RARITY_CLAIM_COOLDOWNS: Record<Rarity, number> = {
  COMMON: config.COOLDOWN_CLAIM_SECONDS_COMMON,
  UNCOMMON: config.COOLDOWN_CLAIM_SECONDS_UNCOMMON,
  RARE: config.COOLDOWN_CLAIM_SECONDS_RARE,
  EPIC: config.COOLDOWN_CLAIM_SECONDS_EPIC,
  LEGENDARY: config.COOLDOWN_CLAIM_SECONDS_LEGENDARY,
};

export const RARITY_DAILY_MARRY_LIMITS: Record<Rarity, number | null> = {
  COMMON: 25,
  UNCOMMON: 20,
  RARE: 15,
  EPIC: 10,
  LEGENDARY: null,
};

export const RARITY_DAILY_TRADE_LIMITS: Record<Rarity, number | null> = {
  COMMON: 25,
  UNCOMMON: 20,
  RARE: 15,
  EPIC: 10,
  LEGENDARY: 10, // Limite de 10 lendárias recebidas por dia em trocas
};

export interface DailyMarryRarityStatus {
  used: number;
  effectiveUsed: number;
  limit: number | null;
  remaining: number | null;
  canMarry: boolean;
  tradeLimit: number | null;
  tradeUsed: number;
  remainingTrades: number | null;
  canTrade: boolean;
}

export interface UserDailyMarryState {
  byRarity: Record<Rarity, DailyMarryRarityStatus>;
  secondsUntilReset: number;
  nextReset: Date;
}

export const ALL_RARITIES: Rarity[] = [
  Rarity.COMMON,
  Rarity.UNCOMMON,
  Rarity.RARE,
  Rarity.EPIC,
  Rarity.LEGENDARY,
];

// Mapeamento de bônus de rolls por ID ou número do usuário (ex: doadores / VIPs).
const USER_ROLL_BUFFS: Record<string, number> = {};

/**
 * Incremento atômico de contador diário com TTL e piso em zero.
 * KEYS[1] = chave; ARGV[1] = delta; ARGV[2] = TTL (s); ARGV[3] = "1" para float.
 */
const INCR_WITH_TTL_LUA = `
local key = KEYS[1]
local delta = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', key) or '0') or 0
local nextValue = current + delta
if nextValue < 0 then nextValue = 0 end
if ARGV[3] == '1' then
  redis.call('SET', key, tostring(nextValue), 'KEEPTTL')
else
  redis.call('SET', key, tostring(math.floor(nextValue)), 'KEEPTTL')
end
if redis.call('TTL', key) < 0 then
  redis.call('EXPIRE', key, ttl)
end
return tostring(nextValue)
`;

const CONSUME_ROLL_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local regenSeconds = tonumber(ARGV[2])
local maxRolls = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local regenMs = regenSeconds * 1000

local raw = redis.call('get', key)
local rolls = maxRolls
local lastUpdate = now

if raw then
  local ok, data = pcall(cjson.decode, raw)
  if ok and data then
    if type(data.rolls) == 'number' then
      rolls = math.min(maxRolls, data.rolls)
    end
    if type(data.lastUpdate) == 'number' then
      lastUpdate = data.lastUpdate
    end
  end
end

if rolls < maxRolls then
  local elapsedMs = now - lastUpdate
  if elapsedMs > 0 then
    local gained = math.floor(elapsedMs / regenMs)
    if gained > 0 then
      rolls = math.min(maxRolls, rolls + gained)
      if rolls >= maxRolls then
        lastUpdate = now
      else
        lastUpdate = lastUpdate + (gained * regenMs)
      end
    end
  end
else
  rolls = maxRolls
  lastUpdate = now
end

local elapsedMs = now - lastUpdate
local secondsIntoPeriod = math.floor(elapsedMs / 1000) % regenSeconds
local secondsToNext = regenSeconds - secondsIntoPeriod

if rolls <= 0 then
  local remainingNeeded = math.max(0, maxRolls - 1 - rolls)
  local fullRecharge = secondsToNext + (remainingNeeded * regenSeconds)
  return { 0, rolls, secondsToNext, fullRecharge, lastUpdate }
end

rolls = rolls - 1
redis.call('set', key, cjson.encode({ rolls = rolls, lastUpdate = lastUpdate }), 'EX', ttl)

local remainingNeeded = math.max(0, maxRolls - 1 - rolls)
local fullRecharge = secondsToNext + (remainingNeeded * regenSeconds)

return { 1, rolls, secondsToNext, fullRecharge, lastUpdate }
`;

const REFUND_ROLL_LUA = `
local key = KEYS[1]
local maxRolls = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local raw = redis.call('get', key)
if raw then
  local ok, data = pcall(cjson.decode, raw)
  if ok and data then
    local rolls = math.min(maxRolls, (data.rolls or 0) + 1)
    data.rolls = rolls
    redis.call('set', key, cjson.encode(data), 'EX', ttl)
    return rolls
  end
end
return -1
`;

export class CooldownService {
  constructor(private redis: Redis) {}

  private userRollsKey(userId: string): string {
    return `rolls:${userId}`;
  }

  private claimKey(userId: string, rarity?: Rarity | string): string {
    if (!rarity) {
      return `cooldown:claim:${userId}`;
    }
    return `cooldown:claim:${userId}:${String(rarity).toUpperCase()}`;
  }

  private legacyClaimKey(userId: string): string {
    return `cooldown:claim:${userId}`;
  }

  private dailyKey(userId: string): string {
    return `cooldown:daily:${userId}`;
  }

  private dailyMarryKey(userId: string, rarity: Rarity): string {
    return `cooldown:daily:marry:${userId}:${rarity}`;
  }

  private dailyTradeKey(userId: string, rarity: Rarity): string {
    return `cooldown:daily:trade:${userId}:${rarity}`;
  }

  private lockKey(groupId: string, characterId: string): string {
    return `lock:char:${groupId}:${characterId}`;
  }

  getUserMaxRolls(userId: string, extraMaxRolls: number = 0): number {
    const cleanId = userId ? userId.replace(/\D/g, '') : '';
    const bonus = USER_ROLL_BUFFS[userId] || (cleanId ? USER_ROLL_BUFFS[cleanId] : 0) || 0;
    const extra = Math.max(0, Math.floor(Number(extraMaxRolls) || 0));
    return config.ROLL_MAX_BASE + bonus + extra;
  }

  getUserRegenSeconds(maxRolls: number): number {
    const extraRolls = Math.max(0, maxRolls - config.ROLL_MAX_BASE);
    const factorPerMille =
      config.ROLL_REGEN_ACCEL_FACTOR !== undefined && config.ROLL_REGEN_ACCEL_FACTOR !== null
        ? Number(config.ROLL_REGEN_ACCEL_FACTOR)
        : 20;
    const factor = factorPerMille / 1000;
    if (extraRolls <= 0 || factor <= 0) {
      return config.ROLL_REGEN_SECONDS;
    }
    const accelRegen = config.ROLL_REGEN_SECONDS / (1 + factor * extraRolls);
    return Math.max(1, Math.round(accelRegen));
  }

  async getUserRolls(userId: string, extraMaxRolls: number = 0): Promise<UserRollsState> {
    const maxRolls = this.getUserMaxRolls(userId, extraMaxRolls);
    const regenSeconds = this.getUserRegenSeconds(maxRolls);
    const key = this.userRollsKey(userId);
    const raw = await this.redis.get(key);
    const now = Date.now();

    let rolls = maxRolls;
    let lastUpdate = now;

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        rolls = typeof parsed.rolls === 'number' ? Math.min(maxRolls, parsed.rolls) : maxRolls;
        lastUpdate = typeof parsed.lastUpdate === 'number' ? parsed.lastUpdate : now;
      } catch (_) {
        rolls = maxRolls;
        lastUpdate = now;
      }
    }

    if (rolls < maxRolls) {
      const elapsedSeconds = Math.max(0, Math.floor((now - lastUpdate) / 1000));
      const gained = Math.floor(elapsedSeconds / regenSeconds);
      if (gained > 0) {
        rolls = Math.min(maxRolls, rolls + gained);
        if (rolls >= maxRolls) {
          lastUpdate = now;
        } else {
          lastUpdate = lastUpdate + gained * regenSeconds * 1000;
        }
      }
    } else {
      rolls = maxRolls;
      lastUpdate = now;
    }

    let secondsToNext = 0;
    let fullRechargeSeconds = 0;

    if (rolls < maxRolls) {
      const elapsedMs = now - lastUpdate;
      const secondsIntoCurrentPeriod = Math.floor(elapsedMs / 1000) % regenSeconds;
      secondsToNext = regenSeconds - secondsIntoCurrentPeriod;
      const remainingNeededRolls = maxRolls - 1 - rolls;
      fullRechargeSeconds = secondsToNext + remainingNeededRolls * regenSeconds;
    }

    const fullRechargeAt = new Date(now + fullRechargeSeconds * 1000);

    return {
      availableRolls: rolls,
      maxRolls,
      secondsToNext,
      fullRechargeSeconds,
      fullRechargeAt,
      regenSeconds,
    };
  }

  async consumeRoll(
    userId: string,
    extraMaxRolls: number = 0
  ): Promise<{ success: boolean; rollsState: UserRollsState }> {
    const maxRolls = this.getUserMaxRolls(userId, extraMaxRolls);
    const regenSeconds = this.getUserRegenSeconds(maxRolls);
    const now = Date.now();
    const ttlSeconds = 30 * 24 * 3600;

    // Execução atômica via Lua script no Redis
    const res = (await this.redis.eval(
      CONSUME_ROLL_LUA,
      1,
      this.userRollsKey(userId),
      now.toString(),
      regenSeconds.toString(),
      maxRolls.toString(),
      ttlSeconds.toString()
    )) as [number, number, number, number, number];

    const [status, remainingRolls, secondsToNext, fullRechargeSeconds] = res;
    const success = status === 1;

    return {
      success,
      rollsState: {
        availableRolls: remainingRolls,
        maxRolls,
        secondsToNext,
        fullRechargeSeconds,
        fullRechargeAt: new Date(now + fullRechargeSeconds * 1000),
        regenSeconds,
      },
    };
  }

  async refundRoll(userId: string, extraMaxRolls: number = 0): Promise<void> {
    const maxRolls = this.getUserMaxRolls(userId, extraMaxRolls);
    const ttlSeconds = 30 * 24 * 3600;
    await this.redis.eval(
      REFUND_ROLL_LUA,
      1,
      this.userRollsKey(userId),
      maxRolls.toString(),
      ttlSeconds.toString()
    );
  }

  async getRollCooldown(userId: string, extraMaxRolls: number = 0) {
    const rollsState = await this.getUserRolls(userId, extraMaxRolls);
    const active = rollsState.availableRolls === 0;
    return {
      active,
      remainingSeconds: rollsState.secondsToNext,
      retryAfter: active ? rollsState.fullRechargeAt : undefined,
      availableRolls: rollsState.availableRolls,
      maxRolls: rollsState.maxRolls,
      fullRechargeSeconds: rollsState.fullRechargeSeconds,
      fullRechargeAt: rollsState.fullRechargeAt,
      regenSeconds: rollsState.regenSeconds,
    };
  }

  getClaimCooldownSecondsForRarity(rarity?: Rarity | string): number {
    if (!rarity) return config.COOLDOWN_CLAIM_SECONDS;
    const norm = String(rarity).toUpperCase() as Rarity;
    return RARITY_CLAIM_COOLDOWNS[norm] ?? config.COOLDOWN_CLAIM_SECONDS;
  }

  async getClaimCooldown(
    userId: string,
    rarity?: Rarity | string
  ): Promise<{ active: boolean; remainingSeconds: number; retryAfter?: Date; rarity?: Rarity; cooldownSeconds: number }> {
    const normRarity = rarity ? (String(rarity).toUpperCase() as Rarity) : undefined;
    const key = this.claimKey(userId, normRarity);

    const [ttl, legacyTtl] = await Promise.all([
      this.redis.ttl(key),
      this.redis.ttl(this.legacyClaimKey(userId)),
    ]);

    const effectiveTtl = Math.max(ttl > 0 ? ttl : 0, legacyTtl > 0 ? legacyTtl : 0);
    const cooldownSeconds = this.getClaimCooldownSecondsForRarity(normRarity);

    if (effectiveTtl > 0) {
      return {
        active: true,
        remainingSeconds: effectiveTtl,
        retryAfter: new Date(Date.now() + effectiveTtl * 1000),
        rarity: normRarity,
        cooldownSeconds,
      };
    }
    return {
      active: false,
      remainingSeconds: 0,
      rarity: normRarity,
      cooldownSeconds,
    };
  }

  /**
   * Libera apenas a trava/cooldown de claim de uma raridade (estorno de um casamento que falhou).
   * Diferente de resetCooldown('claim'), NÃO zera os contadores diários de casamento/troca.
   */
  async releaseClaimCooldown(userId: string, rarity?: Rarity | string): Promise<void> {
    const normRarity = rarity ? (String(rarity).toUpperCase() as Rarity) : undefined;
    await this.redis.del(this.claimKey(userId, normRarity));
  }

  async acquireClaimLock(userId: string, rarity?: Rarity | string, seconds?: number): Promise<boolean> {
    const normRarity = rarity ? (String(rarity).toUpperCase() as Rarity) : undefined;
    const cooldownSecs = seconds ?? this.getClaimCooldownSecondsForRarity(normRarity);

    // Se houver cooldown legado ativo na chave antiga global, bloqueia
    const legacyTtl = await this.redis.ttl(this.legacyClaimKey(userId));
    if (legacyTtl > 0) {
      return false;
    }

    const key = this.claimKey(userId, normRarity);
    const res = await this.redis.set(key, '1', 'EX', cooldownSecs, 'NX');
    return res === 'OK';
  }

  async setClaimCooldown(userId: string, rarity?: Rarity | string, seconds?: number): Promise<void> {
    const normRarity = rarity ? (String(rarity).toUpperCase() as Rarity) : undefined;
    const cooldownSecs = seconds ?? this.getClaimCooldownSecondsForRarity(normRarity);
    const key = this.claimKey(userId, normRarity);
    await this.redis.set(key, '1', 'EX', cooldownSecs);
  }

  async getAllClaimCooldowns(userId: string): Promise<UserClaimCooldownState> {
    const legacyTtl = await this.redis.ttl(this.legacyClaimKey(userId));
    const pipeline = this.redis.pipeline();
    for (const r of ALL_RARITIES) {
      pipeline.ttl(this.claimKey(userId, r));
    }
    const ttls = await pipeline.exec();

    const byRarity: Record<Rarity, ClaimCooldownByRarity> = {} as any;
    let allActive = true;
    let minRemaining = Infinity;
    let minRetryAfter: Date | undefined;

    ALL_RARITIES.forEach((r, idx) => {
      const err = ttls?.[idx]?.[0];
      const val = (ttls?.[idx]?.[1] as number) || -2;
      const rawTtl = err ? 0 : val;
      const effectiveTtl = Math.max(rawTtl > 0 ? rawTtl : 0, legacyTtl > 0 ? legacyTtl : 0);
      const active = effectiveTtl > 0;
      const cooldownSeconds = this.getClaimCooldownSecondsForRarity(r);

      if (active) {
        const retryAfter = new Date(Date.now() + effectiveTtl * 1000);
        byRarity[r] = {
          active: true,
          remainingSeconds: effectiveTtl,
          retryAfter,
          cooldownSeconds,
        };
        if (effectiveTtl < minRemaining) {
          minRemaining = effectiveTtl;
          minRetryAfter = retryAfter;
        }
      } else {
        allActive = false;
        byRarity[r] = {
          active: false,
          remainingSeconds: 0,
          cooldownSeconds,
        };
      }
    });

    return {
      active: allActive,
      remainingSeconds: allActive && minRemaining !== Infinity ? minRemaining : 0,
      retryAfter: allActive ? minRetryAfter : undefined,
      byRarity,
    };
  }

  getDailyCycleInfo(date: Date = new Date()): DailyCycleInfo {
    const resetHourUtc = config.DAILY_RESET_HOUR_UTC;
    const resetMinuteUtc = config.DAILY_RESET_MINUTE_UTC || 0;
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

    const previousCycleStart = new Date(currentCycleStart.getTime() - 24 * 60 * 60 * 1000);
    const secondsUntilReset = Math.max(1, Math.ceil((nextReset.getTime() - date.getTime()) / 1000));

    return {
      previousCycleStart,
      currentCycleStart,
      nextReset,
      secondsUntilReset,
    };
  }

  async getDailyCooldown(userId: string): Promise<{ active: boolean; remainingSeconds: number; retryAfter?: Date }> {
    const ttl = await this.redis.ttl(this.dailyKey(userId));
    if (ttl > 0) {
      return {
        active: true,
        remainingSeconds: ttl,
        retryAfter: new Date(Date.now() + ttl * 1000),
      };
    }
    return { active: false, remainingSeconds: 0 };
  }

  async acquireDailyLock(userId: string, seconds?: number): Promise<boolean> {
    const ttl = seconds ?? this.getDailyCycleInfo().secondsUntilReset;
    const res = await this.redis.set(this.dailyKey(userId), '1', 'EX', ttl, 'NX');
    return res === 'OK';
  }

  async setDailyCooldown(userId: string, seconds?: number): Promise<void> {
    const ttl = seconds ?? this.getDailyCycleInfo().secondsUntilReset;
    await this.redis.set(this.dailyKey(userId), '1', 'EX', ttl);
  }

  async setClaimLock(
    groupId: string,
    characterId: string,
    rolledByUserId: string,
    seconds = config.CLAIM_LOCK_SECONDS
  ): Promise<boolean> {
    const key = this.lockKey(groupId, characterId);
    const result = await this.redis.set(key, rolledByUserId, 'EX', seconds);
    return result === 'OK';
  }

  async getClaimLock(
    groupId: string,
    characterId: string
  ): Promise<{ locked: boolean; rolledByUserId?: string; remainingSeconds: number }> {
    const key = this.lockKey(groupId, characterId);
    const [userId, ttl] = await Promise.all([
      this.redis.get(key),
      this.redis.ttl(key),
    ]);

    if (userId && ttl > 0) {
      return { locked: true, rolledByUserId: userId, remainingSeconds: ttl };
    }
    return { locked: false, remainingSeconds: 0 };
  }

  async releaseClaimLock(groupId: string, characterId: string): Promise<void> {
    await this.redis.del(this.lockKey(groupId, characterId));
  }

  async getAllUserCooldowns(userId: string, extraMaxRolls: number = 0) {
    const [roll, claim, daily, dailyMarry] = await Promise.all([
      this.getRollCooldown(userId, extraMaxRolls),
      this.getAllClaimCooldowns(userId),
      this.getDailyCooldown(userId),
      this.getDailyMarryStatus(userId),
    ]);

    return {
      roll,
      claim,
      daily,
      dailyMarry,
    };
  }

  async getDailyMarryCount(userId: string, rarity: Rarity): Promise<number> {
    const raw = await this.redis.get(this.dailyMarryKey(userId, rarity));
    return raw ? parseFloat(raw) || 0 : 0;
  }

  async getDailyTradeCount(userId: string, rarity: Rarity): Promise<number> {
    const raw = await this.redis.get(this.dailyTradeKey(userId, rarity));
    return raw ? parseInt(raw, 10) || 0 : 0;
  }

  async canMarryDaily(
    userId: string,
    rarity: Rarity,
    isTrade = false
  ): Promise<{ allowed: boolean; reason?: string; used: number; limit: number | null }> {
    if (rarity === Rarity.LEGENDARY) {
      if (isTrade) {
        const tradeUsed = await this.getDailyTradeCount(userId, Rarity.LEGENDARY);
        const tradeLimit = RARITY_DAILY_TRADE_LIMITS.LEGENDARY ?? 10;
        if (tradeUsed >= tradeLimit) {
          return {
            allowed: false,
            reason: `Você atingiu o limite diário de ${tradeLimit} Lendárias recebidas em trocas hoje. O limite reseta às 04:00 BRT.`,
            used: tradeUsed,
            limit: tradeLimit,
          };
        }
        return { allowed: true, used: tradeUsed, limit: tradeLimit };
      }
      return { allowed: true, used: 0, limit: null };
    }

    const limit = RARITY_DAILY_MARRY_LIMITS[rarity];
    if (limit === null || limit === undefined) {
      return { allowed: true, used: 0, limit: null };
    }

    const used = await this.getDailyMarryCount(userId, rarity);
    // Se used < limit, o casamento ou troca é permitido.
    // Ex: com 9 casamentos e 1 troca (9.5 de 10), 9.5 < 10, o !mu-casar é permitido!
    if (used >= limit) {
      const label =
        rarity === Rarity.COMMON
          ? 'Comuns'
          : rarity === Rarity.UNCOMMON
          ? 'Incomuns'
          : rarity === Rarity.RARE
          ? 'Raros'
          : 'Épicos';
      const actionStr = isTrade ? 'trocas/casamentos' : 'casamentos';
      return {
        allowed: false,
        reason: `Você já atingiu seu limite diário de ${actionStr} para personagens ${label} (${limit}/${limit}). O limite reseta às 04:00 BRT.`,
        used,
        limit,
      };
    }

    return { allowed: true, used, limit };
  }

  /**
   * Incrementa um contador diário e garante o TTL até o próximo reset no mesmo script atômico.
   * Antes eram três comandos (INCR + TTL + EXPIRE): uma falha entre eles deixava a chave sem expiração
   * e o jogador bloqueado no limite para sempre.
   */
  private async incrementDailyCounter(key: string, amount: number, isFloat: boolean): Promise<void> {
    const ttl = Math.max(1, this.getDailyCycleInfo().secondsUntilReset);
    await this.redis.eval(INCR_WITH_TTL_LUA, 1, key, String(amount), String(ttl), isFloat ? '1' : '0');
  }

  async incrementDailyMarry(userId: string, rarity: Rarity, amount: number): Promise<void> {
    await this.incrementDailyCounter(this.dailyMarryKey(userId, rarity), amount, true);
  }

  async decrementDailyMarry(userId: string, rarity: Rarity, amount: number): Promise<void> {
    await this.incrementDailyCounter(this.dailyMarryKey(userId, rarity), -amount, true);
  }

  async incrementDailyTrade(userId: string, rarity: Rarity, count: number): Promise<void> {
    await this.incrementDailyCounter(this.dailyTradeKey(userId, rarity), count, false);
  }

  async decrementDailyTrade(userId: string, rarity: Rarity, count: number): Promise<void> {
    await this.incrementDailyCounter(this.dailyTradeKey(userId, rarity), -count, false);
  }

  async getDailyMarryStatus(userId: string): Promise<UserDailyMarryState> {
    const cycle = this.getDailyCycleInfo();
    const pipeline = this.redis.pipeline();
    for (const r of ALL_RARITIES) {
      pipeline.get(this.dailyMarryKey(userId, r));
      pipeline.get(this.dailyTradeKey(userId, r));
    }
    const results = await pipeline.exec();

    const byRarity: Record<Rarity, DailyMarryRarityStatus> = {} as any;

    ALL_RARITIES.forEach((r, idx) => {
      const marryRaw = results?.[idx * 2]?.[1] as string | null;
      const tradeRaw = results?.[idx * 2 + 1]?.[1] as string | null;

      const used = marryRaw ? parseFloat(marryRaw) || 0 : 0;
      const tradeUsed = tradeRaw ? parseInt(tradeRaw, 10) || 0 : 0;
      const effectiveUsed = Math.ceil(used);

      if (r === Rarity.LEGENDARY) {
        const tradeLimit = RARITY_DAILY_TRADE_LIMITS.LEGENDARY ?? 10;
        const remainingTrades = Math.max(0, tradeLimit - tradeUsed);
        byRarity[r] = {
          used: 0,
          effectiveUsed: 0,
          limit: null,
          remaining: null,
          canMarry: true,
          tradeLimit,
          tradeUsed,
          remainingTrades,
          canTrade: tradeUsed < tradeLimit,
        };
      } else {
        const limit = RARITY_DAILY_MARRY_LIMITS[r]!;
        const remaining = Math.max(0, limit - effectiveUsed);
        const canMarry = used < limit;
        const canTrade = used < limit;
        byRarity[r] = {
          used,
          effectiveUsed,
          limit,
          remaining,
          canMarry,
          tradeLimit: limit,
          tradeUsed: Math.floor(used * 2),
          remainingTrades: Math.max(0, Math.floor((limit - used) * 2)),
          canTrade,
        };
      }
    });

    return {
      byRarity,
      secondsUntilReset: cycle.secondsUntilReset,
      nextReset: cycle.nextReset,
    };
  }

  async resetCooldown(userId: string, type: 'roll' | 'claim' | 'daily' | 'all', rarity?: Rarity | string): Promise<void> {
    if (type === 'roll' || type === 'all') {
      await this.redis.del(this.userRollsKey(userId));
    }
    if (type === 'claim' || type === 'all') {
      if (rarity) {
        const normRarity = String(rarity).toUpperCase() as Rarity;
        await this.redis.del(this.claimKey(userId, normRarity));
        await this.redis.del(this.dailyMarryKey(userId, normRarity));
        await this.redis.del(this.dailyTradeKey(userId, normRarity));
      } else {
        const keysToDelete = ALL_RARITIES.map((r) => this.claimKey(userId, r));
        keysToDelete.push(this.legacyClaimKey(userId));
        for (const r of ALL_RARITIES) {
          keysToDelete.push(this.dailyMarryKey(userId, r));
          keysToDelete.push(this.dailyTradeKey(userId, r));
        }
        await this.redis.del(...keysToDelete);
      }
    }
    if (type === 'daily' || type === 'all') {
      await this.redis.del(this.dailyKey(userId));
    }
  }
}
