import { describe, it, expect, vi } from 'vitest';
import { MarketService } from '../src/services/MarketService.js';
import { DomainError } from '../src/errors/DomainError.js';
import { OfferStatus, ListingStatus } from '@prisma/client';

describe('🤝 Classificados v2 — Runas, Buffs, Fazenda & Robustez de Troca', () => {
  it('createOffer deve validar com sucesso quando ofertante possui saldo suficiente de Runas e Petalitas', async () => {
    const mockPrisma: any = {
      marketListing: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'list_1',
          userId: 'seller_123',
          characterId: 'char_target',
          status: ListingStatus.ACTIVE,
          character: { id: 'char_target', name: 'Asuna', isMythic: false },
        }),
      },
      marketOffer: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'off_new', ...args.data })),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'buyer_456', name: 'Buyer', publicId: 'pub_buyer', kakera: 5000 }),
      },
      userNotification: {
        create: vi.fn().mockResolvedValue({}),
      },
    };

    // Mock global fetch para BotAPI
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        runas: 1000,
        fishingBuffs: [{ id: 42, type: 'inventory_slot' }],
        farm: { coins: 5000, items: [{ itemId: 'elixir_sol', quantity: 3 }] },
      }),
    });

    const marketService = new MarketService(mockPrisma);
    const offer = await marketService.createOffer('buyer_456', 'list_1', {
      offeredItems: {
        runas: 500,
        petalitas: 1000,
        fishingBuffIds: [42],
        farmItems: [{ itemId: 'elixir_sol', amount: 2 }],
      },
    });

    expect(offer).toBeDefined();
    expect(mockPrisma.marketOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buyerId: 'buyer_456',
          sellerId: 'seller_123',
          status: OfferStatus.PENDING,
        }),
      })
    );
  });

  it('createOffer deve rejeitar proposta se o usuário tentar oferecer mais Runas do que possui', async () => {
    const mockPrisma: any = {
      marketListing: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'list_1',
          userId: 'seller_123',
          characterId: 'char_target',
          status: ListingStatus.ACTIVE,
          character: { id: 'char_target', name: 'Asuna', isMythic: false },
        }),
      },
      marketOffer: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        runas: 100, // Possui apenas 100
        fishingBuffs: [],
        farm: { coins: 500, items: [] },
      }),
    });

    const marketService = new MarketService(mockPrisma);
    await expect(
      marketService.createOffer('buyer_456', 'list_1', {
        offeredItems: { runas: 500 }, // Tentou oferecer 500
      })
    ).rejects.toThrow(DomainError);
  });

  it('acceptOffer deve travar atômica a oferta com status PROCESSING e impedir concorrência', async () => {
    const mockPrisma: any = {
      marketOffer: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'off_1',
          sellerId: 'seller_123',
          buyerId: 'buyer_456',
          status: OfferStatus.PENDING,
          offeredItems: { runas: 100 },
          listing: {
            id: 'list_1',
            userId: 'seller_123',
            characterId: 'char_target',
            status: ListingStatus.ACTIVE,
            character: { id: 'char_target', name: 'Asuna', isMythic: false },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }), // Simulando que outro processo já travou a oferta
      },
    };

    const marketService = new MarketService(mockPrisma);
    await expect(
      marketService.acceptOffer('seller_123', 'off_1')
    ).rejects.toThrow(DomainError);
  });

  it('acceptOffer deve executar compensating transaction caso a transação PostgreSQL falhe após transferência externa', async () => {
    const mockPrisma: any = {
      marketOffer: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'off_1',
          sellerId: 'seller_123',
          buyerId: 'buyer_456',
          status: OfferStatus.PENDING,
          offeredItems: {
            runas: 250,
            petalitas: 500,
            fishingBuffIds: [42],
            farmItems: [{ itemId: 'elixir_sol', amount: 1 }],
          },
          listing: {
            id: 'list_1',
            userId: 'seller_123',
            characterId: 'char_target',
            status: ListingStatus.ACTIVE,
            character: { id: 'char_target', name: 'Asuna', isMythic: false },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), // Trava atômica com sucesso
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      marketListing: {
        findUnique: vi.fn().mockResolvedValue({ status: ListingStatus.ACTIVE }),
      },
      haremEntry: {
        findFirst: vi.fn().mockResolvedValue({ userId: 'seller_123', characterId: 'char_target' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      // Simulando falha de concorrência ou constraint no PostgreSQL durante a transação
      $transaction: vi.fn().mockRejectedValue(new Error('PG_DEADLOCK_OR_CONSTRAINT_VIOLATION')),
    };

    const fetchCalls: any[] = [];
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      fetchCalls.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      });
    });

    const marketService = new MarketService(mockPrisma);
    const result = await marketService.acceptOffer('seller_123', 'off_1');

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);

    // Deve ter chamado fetch 2 vezes:
    // 1ª: Transferência original: buyer_456 -> seller_123
    // 2ª: Compensating transaction de devolução: seller_123 -> buyer_456
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].body).toMatchObject({
      fromUserId: 'buyer_456',
      toUserId: 'seller_123',
      runas: 250,
      petalitas: 500,
      fishingBuffIds: [42],
    });

    expect(fetchCalls[1].body).toMatchObject({
      fromUserId: 'seller_123', // Devolvendo para o comprador!
      toUserId: 'buyer_456',
      runas: 250,
      petalitas: 500,
      fishingBuffIds: [42],
    });

    // Deve ter atualizado a oferta para CANCELLED com motivo de compensação (condicional ao PROCESSING)
    expect(mockPrisma.marketOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'off_1', status: OfferStatus.PROCESSING },
        data: expect.objectContaining({
          status: OfferStatus.CANCELLED,
          cancelReason: expect.stringContaining('Itens externos foram estornados'),
        }),
      })
    );
  });

  function buildAcceptMock(overrides: any = {}) {
    return {
      marketOffer: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'off_1',
          sellerId: 'seller_123',
          buyerId: 'buyer_456',
          listingId: 'list_1',
          status: OfferStatus.PENDING,
          offeredItems: { runas: 250 },
          listing: {
            id: 'list_1',
            userId: 'seller_123',
            characterId: 'char_target',
            status: ListingStatus.ACTIVE,
            character: { id: 'char_target', name: 'Asuna', isMythic: false },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      marketListing: { findUnique: vi.fn().mockResolvedValue({ status: ListingStatus.ACTIVE }) },
      haremEntry: {
        findFirst: vi.fn().mockResolvedValue({ userId: 'seller_123', characterId: 'char_target' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn().mockRejectedValue(new Error('PG_FAIL')),
      ...overrides,
    } as any;
  }

  it('acceptOffer não afirma estorno quando a compensação externa falha', async () => {
    const mockPrisma = buildAcceptMock();
    let call = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      call++;
      // 1ª chamada (transferência) ok; 2ª (compensação) falha
      return Promise.resolve(
        call === 1
          ? { ok: true, json: async () => ({ success: true }) }
          : { ok: false, status: 500, json: async () => ({ success: false, reason: 'saldo insuficiente' }) }
      );
    });

    const marketService = new MarketService(mockPrisma);
    vi.spyOn((marketService as any).notificationService, 'notifyMarketEvent').mockResolvedValue(undefined);
    const result = await marketService.acceptOffer('seller_123', 'off_1');

    expect(result.success).toBe(false);
    expect(result.reason).not.toContain('estornados com sucesso');
    expect(result.reason).toContain('falhou');
    expect(mockPrisma.marketOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cancelReason: expect.stringContaining('conferência manual') }),
      })
    );
  });

  it('acceptOffer recusa iniciar quando outra oferta do mesmo anúncio já está em processamento', async () => {
    const mockPrisma = buildAcceptMock();
    mockPrisma.marketOffer.count = vi.fn().mockResolvedValue(1);
    global.fetch = vi.fn();

    const marketService = new MarketService(mockPrisma);
    await expect(marketService.acceptOffer('seller_123', 'off_1')).rejects.toThrow(DomainError);

    // Nenhuma transferência externa e a trava PROCESSING é devolvida para PENDING
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPrisma.marketOffer.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'off_1', status: OfferStatus.PROCESSING }),
        data: { status: OfferStatus.PENDING },
      })
    );
  });

  it('acceptOffer cancela a oferta quando o anúncio já não está ativo após a trava', async () => {
    const mockPrisma = buildAcceptMock();
    mockPrisma.marketListing.findUnique = vi.fn().mockResolvedValue({ status: ListingStatus.COMPLETED });
    global.fetch = vi.fn();

    const marketService = new MarketService(mockPrisma);
    await expect(marketService.acceptOffer('seller_123', 'off_1')).rejects.toThrow(DomainError);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPrisma.marketOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: OfferStatus.CANCELLED }) })
    );
  });
});
