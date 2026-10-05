import { Redis } from 'ioredis';
import { config } from '../config.js';

export interface UserRollsState {
  availableRolls: number;
  maxRolls: number;
  secondsToNext: number;
  fullRechargeSeconds: number;
  fullRechargeAt: Date;
}

// Mapeamento de bônus de rolls por ID ou número do usuário (ex: doadores / VIPs).
const USER_ROLL_BUFFS: Record<string, number> = {};

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

  private claimKey(userId: string): string {
    return `cooldown:claim:${userId}`;
  }

  private dailyKey(userId: string): string {
    return `cooldown:daily:${userId}`;
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

  async getUserRolls(userId: string, extraMaxRolls: number = 0): Promise<UserRollsState> {
    const maxRolls = this.getUserMaxRolls(userId, extraMaxRolls);
    const key = this.userRollsKey(userId);
    const raw = await this.redis.get(key);
    const now = Date.now();
    const regenSeconds = config.ROLL_REGEN_SECONDS; // 300s (5 min)

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
    };
  }

  async consumeRoll(
    userId: string,
    extraMaxRolls: number = 0
  ): Promise<{ success: boolean; rollsState: UserRollsState }> {
    const maxRolls = this.getUserMaxRolls(userId, extraMaxRolls);
    const now = Date.now();
    const ttlSeconds = 30 * 24 * 3600;

    // Execução atômica via Lua script no Redis
    const res = (await this.redis.eval(
      CONSUME_ROLL_LUA,
      1,
      this.userRollsKey(userId),
      now.toString(),
      config.ROLL_REGEN_SECONDS.toString(),
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
    };
  }

  async getClaimCooldown(userId: string): Promise<{ active: boolean; remainingSeconds: number; retryAfter?: Date }> {
    const ttl = await this.redis.ttl(this.claimKey(userId));
    if (ttl > 0) {
      return {
        active: true,
        remainingSeconds: ttl,
        retryAfter: new Date(Date.now() + ttl * 1000),
      };
    }
    return { active: false, remainingSeconds: 0 };
  }

  async acquireClaimLock(userId: string, seconds = config.COOLDOWN_CLAIM_SECONDS): Promise<boolean> {
    const res = await this.redis.set(this.claimKey(userId), '1', 'EX', seconds, 'NX');
    return res === 'OK';
  }

  async setClaimCooldown(userId: string, seconds = config.COOLDOWN_CLAIM_SECONDS): Promise<void> {
    await this.redis.set(this.claimKey(userId), '1', 'EX', seconds);
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

  async acquireDailyLock(userId: string, seconds = config.COOLDOWN_DAILY_SECONDS): Promise<boolean> {
    const res = await this.redis.set(this.dailyKey(userId), '1', 'EX', seconds, 'NX');
    return res === 'OK';
  }

  async setDailyCooldown(userId: string, seconds = config.COOLDOWN_DAILY_SECONDS): Promise<void> {
    await this.redis.set(this.dailyKey(userId), '1', 'EX', seconds);
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
    const [roll, claim, daily] = await Promise.all([
      this.getRollCooldown(userId, extraMaxRolls),
      this.getClaimCooldown(userId),
      this.getDailyCooldown(userId),
    ]);

    return {
      roll,
      claim,
      daily,
    };
  }

  async resetCooldown(userId: string, type: 'roll' | 'claim' | 'daily' | 'all'): Promise<void> {
    if (type === 'roll' || type === 'all') {
      await this.redis.del(this.userRollsKey(userId));
    }
    if (type === 'claim' || type === 'all') {
      await this.redis.del(this.claimKey(userId));
    }
    if (type === 'daily' || type === 'all') {
      await this.redis.del(this.dailyKey(userId));
    }
  }
}
