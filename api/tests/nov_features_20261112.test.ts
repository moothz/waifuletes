import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HaremService } from '../src/services/HaremService.js';
import { SuggestionService } from '../src/services/SuggestionService.js';
import { MarketService } from '../src/services/MarketService.js';
import { RollService } from '../src/services/RollService.js';
import { DomainError } from '../src/errors/DomainError.js';

describe('Features Nov/2026 — Backend Rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. HaremService — Raridade > Chaves', () => {
    it('deve ordenar por isMythic, isFavorite, baseRarity, keys no sort padrão', async () => {
      let capturedOrderBy: any = null;
      const mockPrisma: any = {
        haremEntry: {
          findMany: vi.fn().mockImplementation((args) => {
            capturedOrderBy = args.orderBy;
            return Promise.resolve([]);
          }),
          count: vi.fn().mockResolvedValue(0),
        },
        soulmate: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const mockCharService: any = { formatImageUrl: vi.fn((_id, u) => u) };

      const service = new HaremService(mockPrisma, mockCharService);
      await service.getUserHarem('user_1', 1, 20, 'keys');

      expect(capturedOrderBy[0]).toEqual({ character: { isMythic: 'desc' } });
      expect(capturedOrderBy[1]).toEqual({ isFavorite: 'desc' });
      expect(capturedOrderBy[2]).toEqual({ character: { baseRarity: 'desc' } });
      expect(capturedOrderBy[3]).toEqual({ keys: 'desc' });
    });
  });

  describe('2. SuggestionService — Filtros por tipo e approveSuggestionsBatch', () => {
    it('deve filtrar IMAGE_REPLACE, IMAGE_ADD e REPORT_REMOVE corretamente', async () => {
      const capturedWheres: any[] = [];
      const mockPrisma: any = {
        characterSuggestion: {
          count: vi.fn().mockImplementation(({ where }) => {
            capturedWheres.push(where);
            return Promise.resolve(0);
          }),
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const service = new SuggestionService(mockPrisma, { deleteSuggestionMessage: vi.fn() } as any, {} as any);

      await service.listSuggestions({ status: 'PENDING', type: 'IMAGE_REPLACE', limit: 100 });
      await service.listSuggestions({ status: 'PENDING', type: 'IMAGE_ADD', limit: 100 });
      await service.listSuggestions({ status: 'PENDING', type: 'REPORT_REMOVE', limit: 100 });

      expect(capturedWheres[0]).toEqual({
        status: 'PENDING',
        type: 'IMAGE',
        description: { contains: '"action":"REPLACE"' },
      });
      expect(capturedWheres[1].status).toBe('PENDING');
      expect(capturedWheres[1].type).toBe('IMAGE');
      expect(Array.isArray(capturedWheres[1].OR)).toBe(true);
      expect(capturedWheres[2]).toEqual({
        status: 'PENDING',
        OR: [
          { type: 'DELETE_CHARACTER' },
          { type: 'IMAGE', description: { contains: '"action":"DELETE"' } },
        ],
      });
    });

    it('approveSuggestionsBatch deve aprovar apenas os IDs pendentes informados', async () => {
      const mockPrisma: any = {
        characterSuggestion: {
          findMany: vi.fn().mockResolvedValue([{ id: 'sug_1' }, { id: 'sug_2' }]),
        },
      };
      const service = new SuggestionService(
        mockPrisma,
        { deleteSuggestionMessage: vi.fn() } as any,
        {} as any,
        null
      );
      const approveSpy = vi
        .spyOn(service, 'approveSuggestion')
        .mockResolvedValue({ success: true, data: { message: 'ok' } } as any);

      const res = await service.approveSuggestionsBatch(['sug_1', 'sug_2', 'sug_1'], 'admin');

      expect(mockPrisma.characterSuggestion.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['sug_1', 'sug_2'] }, status: 'PENDING' },
        select: { id: true },
      });
      expect(approveSpy).toHaveBeenCalledTimes(2);
      expect(res.data.approvedCount).toBe(2);
    });
  });

  describe('3. MarketService — Rejeição com motivo, Cancelamento pelo comprador e Ordenação', () => {
    it('rejectOffer deve salvar cancelReason quando informado e notificar comprador', async () => {
      const mockPrisma: any = {
        marketOffer: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'off_1',
            listingId: 'lst_1',
            buyerId: 'buyer_1',
            sellerId: 'seller_1',
            status: 'PENDING',
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'off_1',
            status: 'REJECTED',
            cancelReason: 'Valor muito baixo',
            listing: { character: { id: 'c1', name: 'Rem' }, user: { name: 'Vendedor', publicId: 'pub1' } },
          }),
        },
      };
      const service = new MarketService(
        mockPrisma,
        { formatImageUrl: vi.fn() } as any
      );
      const notifySpy = vi.spyOn((service as any).notificationService, 'notifyMarketEvent').mockResolvedValue(undefined);

      await service.rejectOffer('seller_1', 'off_1', '  Valor muito baixo  ');

      expect(mockPrisma.marketOffer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'off_1', sellerId: 'seller_1', status: 'PENDING' },
          data: expect.objectContaining({
            status: 'REJECTED',
            cancelReason: 'Valor muito baixo',
            buyerNotifiedStatus: 'REJECTED',
          }),
        })
      );
      expect(notifySpy).toHaveBeenCalledWith(
        'buyer_1',
        'MARKET_OFFER_REJECTED',
        expect.any(String),
        expect.stringContaining('Valor muito baixo'),
        expect.objectContaining({ reason: 'Valor muito baixo' })
      );
    });

    it('cancelOffer deve permitir comprador cancelar oferta PENDING e bloquear outros usuários', async () => {
      const mockPrisma: any = {
        marketOffer: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'off_1',
            buyerId: 'buyer_1',
            sellerId: 'seller_1',
            status: 'PENDING',
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'off_1',
            status: 'CANCELLED',
            cancelReason: 'Cancelada pelo comprador',
          }),
        },
      };
      const service = new MarketService(mockPrisma, { formatImageUrl: vi.fn() } as any);

      await expect(service.cancelOffer('other_user', 'off_1')).rejects.toThrow(DomainError);

      const res = await service.cancelOffer('buyer_1', 'off_1');
      expect(res.status).toBe('CANCELLED');
      expect(mockPrisma.marketOffer.updateMany).toHaveBeenCalledWith({
        where: { id: 'off_1', buyerId: 'buyer_1', status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          cancelReason: 'Cancelada pelo comprador',
          notifiedBuyer: true,
          buyerNotifiedStatus: 'CANCELLED',
        },
      });
    });

    it('cancelOffer e rejectOffer não sobrescrevem uma oferta que o vendedor já está aceitando (PROCESSING)', async () => {
      const mockPrisma: any = {
        marketOffer: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'off_1',
            buyerId: 'buyer_1',
            sellerId: 'seller_1',
            status: 'PENDING', // leitura defasada: o aceite travou a oferta logo depois
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUniqueOrThrow: vi.fn(),
        },
      };
      const service = new MarketService(mockPrisma, { formatImageUrl: vi.fn() } as any);

      await expect(service.cancelOffer('buyer_1', 'off_1')).rejects.toThrow(DomainError);
      await expect(service.rejectOffer('seller_1', 'off_1', 'não')).rejects.toThrow(DomainError);
      expect(mockPrisma.marketOffer.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('getListings com sortBy=rarity deve priorizar Mítico > Raridade > Chaves', async () => {
      const mockPrisma: any = {
        marketListing: {
          count: vi.fn().mockResolvedValue(3),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'l_rare',
              userId: 'u1',
              character: {
                id: 'c_rare',
                baseRarity: 'RARE',
                isMythic: false,
                imageUrls: [],
                _count: { wishlists: 0 },
                haremEntries: [{ userId: 'u1', keys: 5, isFavorite: false }],
              },
            },
            {
              id: 'l_epic',
              userId: 'u2',
              character: {
                id: 'c_epic',
                baseRarity: 'EPIC',
                isMythic: false,
                imageUrls: [],
                _count: { wishlists: 0 },
                haremEntries: [{ userId: 'u2', keys: 1, isFavorite: false }],
              },
            },
            {
              id: 'l_mythic',
              userId: 'u3',
              character: {
                id: 'c_mythic',
                baseRarity: 'RARE',
                isMythic: true,
                imageUrls: [],
                _count: { wishlists: 0 },
                haremEntries: [{ userId: 'u3', keys: 1, isFavorite: false }],
              },
            },
          ]),
        },
      };
      const service = new MarketService(mockPrisma, {
        getRandomImageUrl: vi.fn((_, imgs) => imgs?.[0] || null),
        formatImageUrl: vi.fn((_, u) => u),
      } as any);

      const res = await service.listGlobalListings({ sortBy: 'rarity' });
      expect(res.listings.map((l: any) => l.id)).toEqual(['l_mythic', 'l_epic', 'l_rare']);
    });
  });

  describe('4. RollService — Devolução de roll ao sortear Mítico', () => {
    it('deve chamar cooldownService.refundRoll e retornar mythicRollRefunded=true para Mítico', async () => {
      const mockCooldown: any = {
        consumeRoll: vi.fn().mockResolvedValue({
          success: true,
          rollsState: {
            availableRolls: 4,
            maxRolls: 9,
            secondsToNext: 100,
            fullRechargeSeconds: 500,
            fullRechargeAt: new Date(),
            regenSeconds: 1800,
          },
        }),
        refundRoll: vi.fn().mockResolvedValue(undefined),
        getUserRolls: vi.fn().mockResolvedValue({
          availableRolls: 5,
          maxRolls: 9,
          secondsToNext: 100,
          fullRechargeSeconds: 400,
          fullRechargeAt: new Date(),
          regenSeconds: 1800,
        }),
        canMarryDaily: vi.fn().mockResolvedValue({ allowed: true }),
        setClaimLock: vi.fn().mockResolvedValue(undefined),
      };

      const mythicChar = {
        id: 'myt_1',
        name: 'Atena Mítica',
        series: 'Mythic Forge',
        description: 'Custom',
        gender: 'FEMALE',
        baseRarity: 'RARE',
        isMythic: true,
        mythicCustomization: null,
        imageUrls: ['img1.jpg'],
        tags: [],
        _count: { wishlists: 0 },
        haremEntries: [],
        investments: [],
      };

      const mockPrisma: any = {
        groupDisabledSeries: { findMany: vi.fn().mockResolvedValue([]) },
        wishlistEntry: { findMany: vi.fn().mockResolvedValue([]) },
        haremEntry: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
        },
        characterInvestment: { findMany: vi.fn().mockResolvedValue([]) },
        character: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue(mythicChar),
        },
        $transaction: vi.fn().mockImplementation(async (fn) => {
          return fn({
            user: {
              upsert: vi.fn().mockResolvedValue({ id: 'u1', kakera: 100 }),
              update: vi.fn().mockResolvedValue({ id: 'u1', kakera: 100 }),
            },
            kakeraTransaction: { create: vi.fn().mockResolvedValue({}) },
          });
        }),
      };

      const mockCharService: any = {
        getRandomImageUrl: vi.fn(() => 'http://img/1.jpg'),
        formatImageUrl: vi.fn((_id, u) => u),
      };

      const rollService = new RollService(mockPrisma, mockCooldown, mockCharService);
      (rollService as any).poolLoaded = true;
      (rollService as any).inMemoryPool = [
        { id: 'myt_1', baseRarity: 'RARE', isMythic: true, gender: 'FEMALE', isDisabled: false, isGlobalDisabled: false },
      ];
      (rollService as any).inMemoryTotalClaims = 0;

      const result: any = await rollService.roll({ userId: 'u1', groupId: 'g1' });

      expect(result.success).toBe(true);
      expect(mockCooldown.refundRoll).toHaveBeenCalledWith('u1', 0);
      expect(result.data.mythicRollRefunded).toBe(true);
      expect(result.data.rollsRemaining).toBe(5);
    });
  });
});
