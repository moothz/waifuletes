import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RollService } from '../src/services/RollService.js';
import { MarketInvestmentService } from '../src/services/MarketInvestmentService.js';
import { MarryService } from '../src/services/MarryService.js';
import { calculateDivorceRefund, KAKERA_CRYSTAL_BASE, KAKERA_CRYSTAL_KEY_BONUS } from '../src/utils/rarityCalculator.js';
import { DomainError } from '../src/errors/DomainError.js';

function createRollMocks(currentKeys: number, ownerId = 'user-1', rollerId = 'user-1') {
  const char = {
    id: 'char-1',
    numericId: 1,
    name: 'Test Waifu',
    series: 'Test Series',
    description: 'Desc',
    gender: 'FEMALE',
    baseRarity: 'RARE',
    isMythic: false,
    mythicCustomization: null,
    imageUrls: ['img.jpg'],
    tags: [],
    likeCount: 0,
    claimCount: 1,
    _count: { wishlists: 0 },
    haremEntries: [
      {
        id: 'harem-1',
        userId: ownerId,
        keys: currentKeys,
        user: { id: ownerId, name: 'Owner' },
      },
    ],
  };

  const mockCooldown: any = {
    consumeRoll: vi.fn().mockResolvedValue({
      success: true,
      rollsState: {
        availableRolls: 5,
        maxRolls: 9,
        secondsToNext: 100,
        fullRechargeSeconds: 400,
        fullRechargeAt: new Date(),
        regenSeconds: 300,
      },
    }),
    refundRoll: vi.fn().mockResolvedValue(undefined),
    addRolls: vi.fn().mockResolvedValue({
      availableRolls: 10,
      maxRolls: 9,
      secondsToNext: 0,
      fullRechargeSeconds: 0,
      fullRechargeAt: new Date(),
      regenSeconds: 300,
    }),
    getUserRolls: vi.fn().mockResolvedValue({ availableRolls: 5, maxRolls: 9 }),
    canMarryDaily: vi.fn().mockResolvedValue({ allowed: true }),
    setClaimLock: vi.fn().mockResolvedValue(undefined),
    getWeeklyLegendaryCount: vi.fn().mockResolvedValue(0),
  };

  const mockCharService: any = {
    getRandomImageUrl: vi.fn(() => 'http://img/1.jpg'),
    formatImageUrl: vi.fn((_id, u) => u),
  };

  let dbKeys = currentKeys;
  const mockPrisma: any = {
    groupDisabledSeries: { findMany: vi.fn().mockResolvedValue([]) },
    wishlistEntry: { findMany: vi.fn().mockResolvedValue([]) },
    characterInvestment: { findMany: vi.fn().mockResolvedValue([]) },
    character: {
      findMany: vi.fn().mockResolvedValue([char]),
      findUnique: vi.fn().mockResolvedValue(char),
    },
    haremEntry: {
      count: vi.fn().mockResolvedValue(1),
      updateMany: vi.fn().mockImplementation(async (args: any) => {
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
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mockPrisma)),
  };

  const service = new RollService(mockPrisma, mockCooldown, mockCharService);
  (service as any).poolLoaded = true;
  (service as any).inMemoryPool = [{ id: 'char-1', baseRarity: 'RARE', gender: 'FEMALE', isMythic: false, rankWeight: 7 }];

  return { service, mockPrisma, getDbKeys: () => dbKeys, setDbKeys: (k: number) => { dbKeys = k; } };
}

describe('🔒 Limite máximo de 10 chaves por personagem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. RollService', () => {
    it('deve evoluir de 9 para 10 chaves e criar Soulmate ao rolar própria waifu', async () => {
      const { service, mockPrisma, getDbKeys } = createRollMocks(9);

      const res: any = await service.roll({ userId: 'user-1', groupId: 'g-1' });

      expect(res.success).toBe(true);
      expect(getDbKeys()).toBe(10);
      expect(mockPrisma.haremEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'harem-1', keys: { lt: 10 } },
        data: { keys: { increment: 1 } },
      });
      expect(mockPrisma.soulmate.upsert).toHaveBeenCalledTimes(1);
      expect(res.data.keyProgress).toEqual({
        currentKeys: 10,
        requiredForSoulmate: 10,
        isSoulmate: true,
        becameSoulmateNow: true,
      });
    });

    it('não deve incrementar além de 10 chaves quando já é Soulmate', async () => {
      const { service, mockPrisma, getDbKeys } = createRollMocks(10);

      const res: any = await service.roll({ userId: 'user-1', groupId: 'g-1' });

      expect(res.success).toBe(true);
      expect(getDbKeys()).toBe(10);
      expect(mockPrisma.haremEntry.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.soulmate.upsert).not.toHaveBeenCalled();
      expect(res.data.keyProgress).toEqual({
        currentKeys: 10,
        requiredForSoulmate: 10,
        isSoulmate: true,
        becameSoulmateNow: false,
      });
    });

    it('não deve ultrapassar 10 chaves em condição de corrida (updateMany count = 0)', async () => {
      const { service, mockPrisma, setDbKeys } = createRollMocks(9);
      // Simula outro request concorrente que já levou keys para 10 antes do updateMany
      setDbKeys(10);

      const res: any = await service.roll({ userId: 'user-1', groupId: 'g-1' });

      expect(res.success).toBe(true);
      expect(mockPrisma.soulmate.upsert).not.toHaveBeenCalled();
      expect(res.data.keyProgress).toEqual({
        currentKeys: 10,
        requiredForSoulmate: 10,
        isSoulmate: true,
        becameSoulmateNow: false,
      });
    });

    it('deve limitar o bônus de cristal de kakera a no máximo 10 chaves', async () => {
      const { service } = createRollMocks(14, 'owner-1', 'roller-2');

      const res: any = await service.roll({ userId: 'roller-2', groupId: 'g-1' });

      expect(res.success).toBe(true);
      expect(res.data.kakeraValue).toBe(KAKERA_CRYSTAL_BASE.RARE + 10 * KAKERA_CRYSTAL_KEY_BONUS);
    });
  });

  describe('2. MarketInvestmentService', () => {
    function createMarketMock(opts: { initialKeys: number; txKeys?: number; shares?: number }) {
      const mockCharacter = {
        id: 'makima',
        name: 'Makima',
        series: 'Chainsaw Man',
        baseRarity: 'EPIC',
        imageUrls: ['makima.jpg'],
        claimCount: 1,
        likeCount: 0,
      };
      const mockCharacterService: any = {
        findCharacter: vi.fn().mockResolvedValue(mockCharacter),
        getRandomImageUrl: vi.fn().mockReturnValue('/media/makima.jpg'),
        formatImageUrl: vi.fn().mockReturnValue('/media/makima.jpg'),
      };

      const txKeys = opts.txKeys ?? opts.initialKeys;
      const mockPrisma: any = {
        user: {
          aggregate: vi.fn().mockResolvedValue({ _sum: { kakera: 4000000 } }),
          findUnique: vi.fn().mockResolvedValue({ id: 'user-1', name: 'Marido', kakera: 50000000 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ baseRarity: 'EPIC', total: 100n, claimed: 10n }]),
        marketOffer: { findMany: vi.fn().mockResolvedValue([]) },
        haremEntry: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'harem-1',
            userId: 'user-1',
            characterId: 'makima',
            keys: opts.initialKeys,
            user: { id: 'user-1', name: 'Marido' },
          }),
          findUnique: vi.fn().mockResolvedValue({
            id: 'harem-1',
            userId: 'user-1',
            keys: txKeys,
          }),
          updateMany: vi.fn().mockImplementation(async (args: any) => {
            const lt = args?.where?.keys?.lt ?? 10;
            const eq = args?.where?.keys?.equals;
            if (txKeys < lt && (eq === undefined || txKeys === eq)) {
              return { count: 1 };
            }
            return { count: 0 };
          }),
        },
        soulmate: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({ id: 'soul-1' }),
        },
        characterInvestment: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue(
            opts.shares ? { id: 'inv-1', shares: opts.shares } : null
          ),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        kakeraTransaction: {
          create: vi.fn().mockResolvedValue({}),
        },
        $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mockPrisma)),
      };

      return { service: new MarketInvestmentService(mockPrisma, mockCharacterService), mockPrisma };
    }

    it('deve evoluir de 9 para 10 chaves ao completar 4 cotas e criar Soulmate', async () => {
      const { service, mockPrisma } = createMarketMock({ initialKeys: 9, txKeys: 9, shares: 3 });
      // Após updateMany incrementar 9->10, findUnique retorna 10
      mockPrisma.haremEntry.findUnique
        .mockResolvedValueOnce({ id: 'harem-1', userId: 'user-1', keys: 9 })
        .mockResolvedValueOnce({ keys: 10 });

      const res = await service.invest({ userId: 'user-1', characterIdOrSlug: 'makima', shares: 1 });

      expect(res.keyEarned).toBe(true);
      expect(res.currentKeys).toBe(10);
      expect(res.becameSoulmate).toBe(true);
      expect(mockPrisma.haremEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'harem-1', userId: 'user-1', keys: { lt: 10, equals: 9 } },
        data: { keys: { increment: 1 } },
      });
    });

    it('deve abortar transação com ALREADY_SOULMATE se keys chegar a 10 por corrida antes do commit', async () => {
      const { service } = createMarketMock({ initialKeys: 9, txKeys: 10, shares: 3 });

      await expect(
        service.invest({ userId: 'user-1', characterIdOrSlug: 'makima', shares: 1 })
      ).rejects.toThrowError(DomainError);
    });
  });

  describe('3. MarryService.adminMarry', () => {
    it('não deve conceder chave além de 10 em adminMarry', async () => {
      const mockChar = {
        id: 'char-1',
        name: 'Frieren',
        series: 'Frieren',
        baseRarity: 'LEGENDARY',
        imageUrls: [],
        haremEntries: [{ id: 'h-1', keys: 10, user: { id: 'user-1', name: 'User' } }],
      };
      const mockPrisma: any = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: 'user-1' }),
          upsert: vi.fn().mockResolvedValue({ id: 'user-1' }),
        },
        group: { upsert: vi.fn().mockResolvedValue({ id: 'admin' }) },
        userGroup: { upsert: vi.fn().mockResolvedValue({}) },
        character: { findUnique: vi.fn().mockResolvedValue(mockChar) },
        haremEntry: { updateMany: vi.fn() },
      };
      const service = new MarryService(
        mockPrisma,
        { releaseClaimLock: vi.fn() } as any,
        { findCharacter: vi.fn().mockResolvedValue(mockChar), getRandomImageUrl: vi.fn() } as any
      );

      const res = await service.adminMarry({ userId: 'user-1', characterId: 'char-1' });
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('ALREADY_SOULMATE');
      expect(mockPrisma.haremEntry.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('4. calculateDivorceRefund', () => {
    it('deve limitar keysBonus e remainingKeys a no máximo 10 chaves mesmo se keys > 10', () => {
      const at10 = calculateDivorceRefund('EPIC', 10, { isSoulmate: true, inflationMultiplier: 1.5 });
      const at14 = calculateDivorceRefund('EPIC', 14, { isSoulmate: true, inflationMultiplier: 1.5 });

      expect(at14.keysBonus).toBe(at10.keysBonus);
      expect(at14.rawValue).toBe(at10.rawValue);
      expect(at14.netKakera).toBe(at10.netKakera);
      expect(at14.remainingKeys).toBe(at10.remainingKeys);
    });
  });
});
