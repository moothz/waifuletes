import { describe, it, expect, vi } from 'vitest';
import { calculateCharacterSharePricing } from '../src/utils/rarityCalculator.js';
import { MarketInvestmentService } from '../src/services/MarketInvestmentService.js';
import { MarketService } from '../src/services/MarketService.js';
import { config } from '../src/config.js';

describe('Sobretaxa por chaves extras no harém e flags dos classificados', () => {
  it('aplica exatamente +0.5% por chave acima de 1 (ex: 3 chars com 4 chaves = +4.5%)', () => {
    const base = calculateCharacterSharePricing({
      baseRarity: 'RARE',
      baseDynamicPrice: 1_000_000,
      scarcityMultiplier: 1.0,
      inflationMultiplier: 1.0,
      rankMultiplier: 1.0,
      isOwner: false,
      haremExtraKeys: 0,
      extraKeySurchargePercent: 0.5,
    });

    const with9ExtraKeys = calculateCharacterSharePricing({
      baseRarity: 'RARE',
      baseDynamicPrice: 1_000_000,
      scarcityMultiplier: 1.0,
      inflationMultiplier: 1.0,
      rankMultiplier: 1.0,
      isOwner: false,
      haremExtraKeys: 9,
      extraKeySurchargePercent: 0.5,
    });

    expect(base.haremSurchargePercent).toBe(0);
    expect(with9ExtraKeys.haremSurchargePercent).toBe(4.5);
    expect(with9ExtraKeys.dynamicPrice).toBe(Math.round(base.dynamicPrice * 1.045));
    expect(with9ExtraKeys.cotaPrice).toBe(Math.ceil(with9ExtraKeys.dynamicPrice / 4));
  });

  it('soma apenas chaves acima de 1 no harém do usuário via MarketInvestmentService', async () => {
    const mockPrisma: any = {
      user: { aggregate: vi.fn().mockResolvedValue({ _sum: { kakera: 4_000_000 } }) },
      $queryRaw: vi.fn().mockResolvedValue([
        { baseRarity: 'COMMON', total: 100n, claimed: 0n },
        { baseRarity: 'UNCOMMON', total: 100n, claimed: 0n },
        { baseRarity: 'RARE', total: 100n, claimed: 0n },
        { baseRarity: 'EPIC', total: 100n, claimed: 0n },
        { baseRarity: 'LEGENDARY', total: 100n, claimed: 0n },
      ]),
      haremEntry: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([
          { keys: 4 },
          { keys: 4 },
          { keys: 4 },
        ]),
      },
      marketOffer: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      characterInvestment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const mockCharService: any = {
      findCharacter: vi.fn().mockResolvedValue({
        id: 'char-1',
        name: 'Teste',
        series: 'Anime',
        baseRarity: 'COMMON',
        rarityRank: 100,
        imageUrls: [],
        claimCount: 0,
        likeCount: 0,
        isMythic: false,
      }),
      getRandomImageUrl: vi.fn().mockReturnValue(null),
      formatImageUrl: vi.fn().mockReturnValue(''),
    };

    const svc = new MarketInvestmentService(mockPrisma, mockCharService);
    const quote = await svc.getCharacterQuote('char-1', 'user-1');

    expect(quote.pricing.haremExtraKeys).toBe(9);
    expect(quote.pricing.haremSurchargePercent).toBe(4.5);
  });

  it('bloqueia envio de Runas e itens da fazenda nos classificados quando flags estão desabilitadas', async () => {
    const prevRunas = config.MARKET_ALLOW_RUNAS_OFFER;
    const prevFarm = config.MARKET_ALLOW_FARM_ITEMS_OFFER;
    config.MARKET_ALLOW_RUNAS_OFFER = false;
    config.MARKET_ALLOW_FARM_ITEMS_OFFER = false;

    try {
      const mockPrisma: any = {
        marketListing: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'listing-1',
            userId: 'seller-1',
            status: 'ACTIVE',
            character: { id: 'c1', name: 'Waifu' },
          }),
        },
        marketOffer: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };
      const svc = new MarketService(mockPrisma, {} as any);

      await expect(
        svc.createOffer('buyer-1', 'listing-1', {
          offeredItems: { runas: 100 },
        })
      ).rejects.toMatchObject({ code: 'RUNAS_OFFER_DISABLED' });

      await expect(
        svc.createOffer('buyer-1', 'listing-1', {
          offeredItems: { farmItems: [{ itemId: '01_nightshade', amount: 1 }] },
        })
      ).rejects.toMatchObject({ code: 'FARM_ITEMS_OFFER_DISABLED' });
    } finally {
      config.MARKET_ALLOW_RUNAS_OFFER = prevRunas;
      config.MARKET_ALLOW_FARM_ITEMS_OFFER = prevFarm;
    }
  });
});
