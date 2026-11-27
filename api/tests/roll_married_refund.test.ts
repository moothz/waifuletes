import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import Fastify from 'fastify';
import { RollService } from '../src/services/RollService.js';
import { config } from '../src/config.js';
import { userWebRoutes } from '../src/routes/web/userWebRoutes.js';

function createMockSetup(opts: {
  isClaimed?: boolean;
  isOwner?: boolean;
  keys?: number;
  isMythic?: boolean;
  raceConditionCap?: boolean;
  failRewardTx?: boolean;
  initialAvailableAfterConsume?: number;
}) {
  const ownerId = 'owner-1';
  const rollerId = opts.isOwner ? ownerId : 'roller-2';
  const initialKeys = opts.keys ?? 1;
  let dbKeys = initialKeys;

  const char = {
    id: 'char-test-1',
    numericId: 101,
    name: 'Waifu Teste',
    series: 'Série Teste',
    description: 'Desc',
    gender: 'FEMALE' as const,
    baseRarity: 'RARE' as const,
    isMythic: Boolean(opts.isMythic),
    mythicCustomization: null,
    imageUrls: ['img.jpg'],
    tags: [],
    likeCount: 0,
    claimCount: opts.isClaimed ? 1 : 0,
    _count: { wishlists: 0 },
    haremEntries: opts.isClaimed
      ? [
          {
            id: 'harem-1',
            userId: ownerId,
            keys: initialKeys,
            user: { id: ownerId, name: 'Dono Teste' },
          },
        ]
      : [],
  };

  let currentRolls = opts.initialAvailableAfterConsume ?? 8;

  const mockCooldown: any = {
    consumeRoll: vi.fn().mockImplementation(async () => ({
      success: true,
      rollsState: {
        availableRolls: currentRolls,
        maxRolls: 9,
        secondsToNext: 120,
        fullRechargeSeconds: 300,
        fullRechargeAt: new Date(),
        regenSeconds: 300,
      },
    })),
    refundRoll: vi.fn().mockImplementation(async () => {
      currentRolls += 1;
    }),
    addRolls: vi.fn().mockImplementation(async (_userId: string, amount: number) => {
      currentRolls += amount;
      return {
        availableRolls: currentRolls,
        maxRolls: 9,
        secondsToNext: currentRolls >= 9 ? 0 : 120,
        fullRechargeSeconds: currentRolls >= 9 ? 0 : 300,
        fullRechargeAt: new Date(),
        regenSeconds: 300,
      };
    }),
    getUserRolls: vi.fn().mockImplementation(async () => ({
      availableRolls: currentRolls,
      maxRolls: 9,
      secondsToNext: currentRolls >= 9 ? 0 : 120,
      fullRechargeSeconds: currentRolls >= 9 ? 0 : 300,
      fullRechargeAt: new Date(),
      regenSeconds: 300,
    })),
    canMarryDaily: vi.fn().mockResolvedValue({ allowed: true }),
    setClaimLock: vi.fn().mockResolvedValue(undefined),
    getWeeklyLegendaryCount: vi.fn().mockResolvedValue(0),
    setWeeklyLegendaryCount: vi.fn().mockResolvedValue(true),
    getWeeklyCycleInfo: vi.fn().mockReturnValue({ currentCycleStart: new Date() }),
  };

  const mockCharService: any = {
    getRandomImageUrl: vi.fn(() => 'http://img/1.jpg'),
    formatImageUrl: vi.fn((_id, u) => u),
  };

  const mockPrisma: any = {
    groupDisabledSeries: { findMany: vi.fn().mockResolvedValue([]) },
    wishlistEntry: { findMany: vi.fn().mockResolvedValue([]) },
    characterInvestment: { findMany: vi.fn().mockResolvedValue([]) },
    character: {
      findMany: vi.fn().mockResolvedValue([char]),
      findUnique: vi.fn().mockResolvedValue(char),
    },
    haremEntry: {
      count: vi.fn().mockResolvedValue(opts.isClaimed ? 1 : 0),
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        if (opts.raceConditionCap) {
          dbKeys = 10;
          return { count: 0 };
        }
        const lt = args?.where?.keys?.lt ?? Infinity;
        if (dbKeys < lt) {
          dbKeys += 1;
          return { count: 1 };
        }
        return { count: 0 };
      }),
      findUnique: vi.fn().mockImplementation(async () => ({ keys: dbKeys })),
    },
    soulmate: {
      upsert: vi.fn().mockResolvedValue({ id: 'soul-1' }),
    },
    user: {
      update: vi.fn().mockResolvedValue({ id: rollerId, kakera: 1000 }),
    },
    kakeraTransaction: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (fn: any) => {
      if (opts.failRewardTx) {
        throw new Error('DB_TX_FAILED');
      }
      return fn(mockPrisma);
    }),
  };

  const service = new RollService(mockPrisma, mockCooldown, mockCharService);
  (service as any).poolLoaded = true;
  (service as any).inMemoryPool = [
    {
      id: char.id,
      baseRarity: char.baseRarity,
      gender: char.gender,
      isMythic: Boolean(opts.isMythic),
      rankWeight: 7,
    },
  ];

  return { service, mockCooldown, mockPrisma, rollerId };
}

describe('🎲 Refund de roll de casados e +5 rolls em Soulmate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve ter default 0.75 para ROLL_MARRIED_REFUND_CHANCE e 5 para ROLL_SOULMATE_BONUS_ROLLS', () => {
    expect(config.ROLL_MARRIED_REFUND_CHANCE).toBe(0.75);
    expect(config.ROLL_SOULMATE_BONUS_ROLLS).toBe(5);
  });

  it('deve devolver o roll (75% chance) quando tira personagem casado de outro jogador', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { service, mockCooldown, rollerId } = createMockSetup({
      isClaimed: true,
      isOwner: false,
      keys: 3,
      initialAvailableAfterConsume: 8,
    });

    const res: any = await service.roll({ userId: rollerId, groupId: 'g-1' });

    expect(res.success).toBe(true);
    expect(mockCooldown.refundRoll).toHaveBeenCalledTimes(1);
    expect(mockCooldown.refundRoll).toHaveBeenCalledWith(rollerId, 0);
    expect(mockCooldown.addRolls).not.toHaveBeenCalled();
    expect(res.data.marriedRollRefunded).toBe(true);
    expect(res.data.soulmateBonusRolls).toBe(0);
    expect(res.data.rollsRemaining).toBe(9);
  });

  it('não deve devolver o roll quando a chance de 75% não bate (>= 0.75)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.8);
    const { service, mockCooldown, rollerId } = createMockSetup({
      isClaimed: true,
      isOwner: false,
      keys: 3,
      initialAvailableAfterConsume: 8,
    });

    const res: any = await service.roll({ userId: rollerId, groupId: 'g-1' });

    expect(res.success).toBe(true);
    expect(mockCooldown.refundRoll).not.toHaveBeenCalled();
    expect(mockCooldown.addRolls).not.toHaveBeenCalled();
    expect(res.data.marriedRollRefunded).toBe(false);
    expect(res.data.soulmateBonusRolls).toBe(0);
    expect(res.data.rollsRemaining).toBe(8);
  });

  it('em isFreeRoll com casado de outro e chance favorável, sinaliza marriedRollRefunded sem chamar refundRoll no Redis', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    const { service, mockCooldown, rollerId } = createMockSetup({
      isClaimed: true,
      isOwner: false,
      keys: 2,
      initialAvailableAfterConsume: 8,
    });

    const res: any = await service.roll({
      userId: rollerId,
      groupId: 'g-1',
      bonuses: { isFreeRoll: true },
    });

    expect(res.success).toBe(true);
    expect(mockCooldown.consumeRoll).not.toHaveBeenCalled();
    expect(mockCooldown.refundRoll).not.toHaveBeenCalled();
    expect(res.data.marriedRollRefunded).toBe(true);
    expect(res.data.soulmateBonusRolls).toBe(0);
  });

  it('não deve dar refund quando tira próprio personagem que ainda gera chave (incluindo 9 -> 10)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const { service, mockCooldown, rollerId } = createMockSetup({
      isClaimed: true,
      isOwner: true,
      keys: 9,
      initialAvailableAfterConsume: 8,
    });

    const res: any = await service.roll({ userId: rollerId, groupId: 'g-1' });

    expect(res.success).toBe(true);
    expect(res.data.keyProgress.becameSoulmateNow).toBe(true);
    expect(mockCooldown.refundRoll).not.toHaveBeenCalled();
    expect(mockCooldown.addRolls).not.toHaveBeenCalled();
    expect(res.data.marriedRollRefunded).toBe(false);
    expect(res.data.soulmateBonusRolls).toBe(0);
    expect(res.data.rollsRemaining).toBe(8);
  });

  it('deve conceder +5 rolls grátis quando já é Soulmate (não gera chave), indo de 8/9 para 13/9', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { service, mockCooldown, rollerId } = createMockSetup({
      isClaimed: true,
      isOwner: true,
      keys: 10,
      initialAvailableAfterConsume: 8,
    });

    const res: any = await service.roll({ userId: rollerId, groupId: 'g-1' });

    expect(res.success).toBe(true);
    expect(mockCooldown.addRolls).toHaveBeenCalledTimes(1);
    expect(mockCooldown.addRolls).toHaveBeenCalledWith(rollerId, 5, 0);
    expect(mockCooldown.refundRoll).not.toHaveBeenCalled();
    expect(res.data.marriedRollRefunded).toBe(false);
    expect(res.data.soulmateBonusRolls).toBe(5);
    expect(res.data.rollsRemaining).toBe(13);
  });

  it('deve conceder +5 rolls grátis em condição de corrida que atingiu 10 chaves antes do updateMany', async () => {
    const { service, mockCooldown, rollerId } = createMockSetup({
      isClaimed: true,
      isOwner: true,
      keys: 9,
      raceConditionCap: true,
      initialAvailableAfterConsume: 8,
    });

    const res: any = await service.roll({ userId: rollerId, groupId: 'g-1' });

    expect(res.success).toBe(true);
    expect(res.data.keyProgress.isSoulmate).toBe(true);
    expect(res.data.keyProgress.becameSoulmateNow).toBe(false);
    expect(mockCooldown.addRolls).toHaveBeenCalledWith(rollerId, 5, 0);
    expect(res.data.soulmateBonusRolls).toBe(5);
    expect(res.data.rollsRemaining).toBe(13);
  });

  it('personagem Mítico casado mantém apenas mythicRollRefunded sem marriedRollRefunded ou bônus soulmate', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const { service, mockCooldown, rollerId } = createMockSetup({
      isClaimed: true,
      isOwner: false,
      isMythic: true,
      initialAvailableAfterConsume: 8,
    });

    const res: any = await service.roll({ userId: rollerId, groupId: 'g-1' });

    expect(res.success).toBe(true);
    expect(mockCooldown.refundRoll).toHaveBeenCalledTimes(1);
    expect(mockCooldown.addRolls).not.toHaveBeenCalled();
    expect(res.data.mythicRollRefunded).toBe(true);
    expect(res.data.marriedRollRefunded).toBe(false);
    expect(res.data.soulmateBonusRolls).toBe(0);
  });

  it('não deve estornar novamente no catch se já houve marriedRollRefunded', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const { service, mockCooldown, rollerId } = createMockSetup({
      isClaimed: true,
      isOwner: false,
      keys: 2,
      failRewardTx: true,
      initialAvailableAfterConsume: 8,
    });

    await expect(service.roll({ userId: rollerId, groupId: 'g-1' })).rejects.toThrow('DB_TX_FAILED');
    expect(mockCooldown.refundRoll).toHaveBeenCalledTimes(1);
  });

  it('Waifinder (/api/web/user/:publicId/waifinder/roll) deve estornar bônus da fazenda quando marriedRollRefunded=true', async () => {
    const refunds: Array<{ userId: string; type: string }> = [];
    const mockRavenaServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (req.url === '/api/waifu/farm-bonus/reserve' && req.method === 'POST') {
          res.end(
            JSON.stringify({
              success: true,
              data: {
                reserved: true,
                type: 'roll',
                remainingRolls: 0,
                remainingTickets: 0,
                donorBonuses: null,
                extraMaxRolls: 0,
                eventRarosMult: 1,
                eventWishMult: 1,
              },
            })
          );
          return;
        }
        if (req.url === '/api/waifu/farm-bonus/refund' && req.method === 'POST') {
          refunds.push({ userId: body.userId, type: body.type });
          res.end(JSON.stringify({ success: true, refunded: true }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ success: false }));
      });
    });

    await new Promise<void>((resolve) => mockRavenaServer.listen(0, '127.0.0.1', resolve));
    const addr = mockRavenaServer.address() as { port: number };
    const prevUrl = config.RAVENA_API_URL;
    config.RAVENA_API_URL = `http://127.0.0.1:${addr.port}`;

    const app = Fastify();
    const mockRedis: any = {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({ userId: 'u_wf_1', publicId: 'pub_wf_1', expiresAt: Date.now() + 60000 })
      ),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      pexpire: vi.fn().mockResolvedValue(1),
      ttl: vi.fn().mockResolvedValue(-2),
    };
    const mockPrisma: any = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u_wf_1', publicId: 'pub_wf_1' }) },
      characterCovet: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    app.decorate('prisma', mockPrisma);
    app.decorate('redis', mockRedis);
    app.decorate('rollService', {
      roll: vi.fn().mockResolvedValue({
        success: true,
        data: {
          character: {
            id: 'char-married',
            numericId: 77,
            name: 'Casada',
            series: 'Anime',
            description: 'Desc',
            gender: 'FEMALE',
            rarity: 'RARE',
            baseRarity: 'RARE',
            isMythic: false,
            imageUrl: '/media/characters/char-married/default.jpg',
          },
          isMythic: false,
          mythicRollRefunded: false,
          marriedRollRefunded: true,
          soulmateBonusRolls: 0,
          available: false,
          isWishlist: false,
          isStarWish: false,
          wishlistUsers: [],
          isOwner: false,
          owner: { id: 'other-1', name: 'Outro' },
          instantMarriage: false,
          keyProgress: null,
          kakeraValue: 50,
          rollReward: { totalScrap: 20 },
          rollsRemaining: 9,
          maxRolls: 9,
          nextRollSeconds: 0,
          fullRechargeSeconds: 0,
        },
      }),
    } as any);

    await app.register(userWebRoutes);
    await app.ready();

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/web/user/pub_wf_1/waifinder/roll',
        payload: { token: 'tok_wf_1', gender: 'ALL' },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.marriedRollRefunded).toBe(true);
      expect(json.data.usedFarmBonus).toBeNull();
      expect(json.data.rolls.farmRolls).toBe(1);
      expect(refunds).toEqual([{ userId: 'u_wf_1', type: 'roll' }]);
    } finally {
      config.RAVENA_API_URL = prevUrl;
      await app.close();
      await new Promise<void>((resolve) => mockRavenaServer.close(() => resolve()));
    }
  });
});
