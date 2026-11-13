import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListingStatus, OfferStatus } from '@prisma/client';
import { MarketService, UNLISTED_OFFER_REJECTION_REASON } from '../src/services/MarketService.js';
import { SuggestionService } from '../src/services/SuggestionService.js';
import { DomainError } from '../src/errors/DomainError.js';

describe('📢 Ofertas nos classificados quando o personagem sai do anúncio', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('cancelListing marca todas as ofertas pendentes como REJECTED com motivo "Personagem não está mais anunciado"', async () => {
    const tx: any = {
      marketOffer: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
      marketListing: { update: vi.fn().mockResolvedValue({ id: 'lst_1', status: ListingStatus.CANCELLED }) },
    };
    const mockPrisma: any = {
      marketListing: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'lst_1',
          userId: 'seller_1',
          status: ListingStatus.ACTIVE,
        }),
      },
      $transaction: vi.fn((cb: any) => cb(tx)),
    };

    const market = new MarketService(mockPrisma);
    const res = await market.cancelListing('seller_1', 'lst_1');

    expect(res.status).toBe(ListingStatus.CANCELLED);
    expect(tx.marketOffer.updateMany).toHaveBeenCalledWith({
      where: { listingId: { in: ['lst_1'] }, status: OfferStatus.PENDING },
      data: {
        status: OfferStatus.REJECTED,
        cancelReason: 'Personagem não está mais anunciado',
        notifiedBuyer: false,
        buyerNotifiedStatus: 'REJECTED',
      },
    });
  });

  it('acceptOffer marca outras ofertas do mesmo anúncio e de anúncios relacionados como REJECTED', async () => {
    const offerUpdateCalls: any[] = [];
    const listingUpdateCalls: any[] = [];

    const tx: any = {
      marketListing: {
        updateMany: vi.fn((args: any) => {
          listingUpdateCalls.push(args);
          return Promise.resolve({ count: 1 });
        }),
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'lst_dup' }]) // sameCharListings
          .mockResolvedValueOnce([{ id: 'lst_traded_waifu' }]), // offeredListings
      },
      haremEntry: {
        findFirst: vi.fn().mockResolvedValue({ collectionId: null }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      characterCovet: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      marketOffer: {
        updateMany: vi.fn((args: any) => {
          offerUpdateCalls.push(args);
          return Promise.resolve({ count: 1 });
        }),
      },
      user: { update: vi.fn() },
      kakeraTransaction: { createMany: vi.fn() },
    };

    const mockPrisma: any = {
      marketOffer: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'off_win',
          listingId: 'lst_main',
          buyerId: 'buyer_1',
          sellerId: 'seller_1',
          status: OfferStatus.PENDING,
          offeredItems: { waifuIds: ['char_offered'] },
          listing: {
            id: 'lst_main',
            userId: 'seller_1',
            characterId: 'char_listed',
            status: ListingStatus.ACTIVE,
            character: { id: 'char_listed', name: 'Kasumi', baseRarity: 'EPIC', isMythic: false },
            user: { name: 'Vendedor', publicId: 'pub_s' },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      marketListing: {
        findUnique: vi.fn().mockResolvedValue({ status: ListingStatus.ACTIVE }),
      },
      haremEntry: {
        findFirst: vi.fn().mockResolvedValue({ userId: 'seller_1', characterId: 'char_listed' }),
        findMany: vi.fn().mockResolvedValue([
          {
            userId: 'buyer_1',
            characterId: 'char_offered',
            character: { id: 'char_offered', name: 'Futaba', baseRarity: 'RARE', isMythic: false },
          },
        ]),
      },
      $transaction: vi.fn((cb: any) => cb(tx)),
    };

    const market = new MarketService(mockPrisma);
    vi.spyOn((market as any).notificationService, 'notifyMarketEvent').mockResolvedValue(undefined);

    const res = await market.acceptOffer('seller_1', 'off_win');
    expect(res.success).toBe(true);

    const rejectedBatches = offerUpdateCalls.filter((c) => c.data?.status === OfferStatus.REJECTED);
    expect(rejectedBatches).toEqual([
      {
        where: { listingId: { in: ['lst_dup'] }, status: OfferStatus.PENDING },
        data: {
          status: OfferStatus.REJECTED,
          cancelReason: UNLISTED_OFFER_REJECTION_REASON,
          notifiedBuyer: false,
          buyerNotifiedStatus: 'REJECTED',
        },
      },
      {
        where: { listingId: { in: ['lst_traded_waifu'] }, status: OfferStatus.PENDING },
        data: {
          status: OfferStatus.REJECTED,
          cancelReason: UNLISTED_OFFER_REJECTION_REASON,
          notifiedBuyer: false,
          buyerNotifiedStatus: 'REJECTED',
        },
      },
      {
        where: { listingId: { in: ['lst_main'] }, id: { not: 'off_win' }, status: OfferStatus.PENDING },
        data: {
          status: OfferStatus.REJECTED,
          cancelReason: UNLISTED_OFFER_REJECTION_REASON,
          notifiedBuyer: false,
          buyerNotifiedStatus: 'REJECTED',
        },
      },
    ]);
    expect(listingUpdateCalls).toEqual(
      expect.arrayContaining([
        { where: { id: { in: ['lst_dup'] } }, data: { status: ListingStatus.CANCELLED } },
        { where: { id: { in: ['lst_traded_waifu'] } }, data: { status: ListingStatus.CANCELLED } },
      ])
    );
  });

  it('acceptOffer quando vendedor não possui mais o personagem encerra anúncio e recusa TODAS as ofertas pendentes', async () => {
    const mockPrisma: any = {
      marketOffer: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'off_1',
          listingId: 'lst_1',
          buyerId: 'buyer_1',
          sellerId: 'seller_1',
          status: OfferStatus.PENDING,
          offeredItems: { zinthos: 100 },
          listing: {
            id: 'lst_1',
            userId: 'seller_1',
            characterId: 'char_1',
            status: ListingStatus.ACTIVE,
            character: { id: 'char_1', name: 'Makoto', isMythic: false },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      marketListing: {
        findUnique: vi.fn().mockResolvedValue({ status: ListingStatus.ACTIVE }),
        update: vi.fn().mockResolvedValue({ id: 'lst_1', status: ListingStatus.CANCELLED }),
      },
      haremEntry: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const market = new MarketService(mockPrisma);
    await expect(market.acceptOffer('seller_1', 'off_1')).rejects.toThrow(DomainError);

    expect(mockPrisma.marketListing.update).toHaveBeenCalledWith({
      where: { id: 'lst_1' },
      data: { status: ListingStatus.CANCELLED },
    });
    expect(mockPrisma.marketOffer.updateMany).toHaveBeenCalledWith({
      where: { id: 'off_1', status: OfferStatus.PROCESSING },
      data: expect.objectContaining({
        status: OfferStatus.REJECTED,
        cancelReason: 'Personagem não está mais anunciado',
        buyerNotifiedStatus: 'REJECTED',
      }),
    });
    expect(mockPrisma.marketOffer.updateMany).toHaveBeenCalledWith({
      where: { listingId: { in: ['lst_1'] }, id: { not: 'off_1' }, status: OfferStatus.PENDING },
      data: expect.objectContaining({
        status: OfferStatus.REJECTED,
        cancelReason: 'Personagem não está mais anunciado',
        buyerNotifiedStatus: 'REJECTED',
      }),
    });
  });

  it('SuggestionService.deactivateCharacter cancela anúncios ativos e recusa ofertas pendentes do personagem', async () => {
    const mockPrisma: any = {
      character: {
        findUnique: vi.fn().mockResolvedValue({ id: 'char_del', name: 'Personagem Removido', isActive: true }),
        update: vi.fn().mockResolvedValue({ id: 'char_del', isActive: false }),
      },
      marketListing: {
        findMany: vi.fn().mockResolvedValue([{ id: 'lst_del' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      marketOffer: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      characterSuggestion: {
        create: vi.fn().mockResolvedValue({ id: 'sug_1' }),
      },
    };

    const service = new SuggestionService(mockPrisma, null as any, { invalidateCharacterCaches: vi.fn() } as any);
    await service.deactivateCharacter('char_del', 'Denúncia', 'Admin');

    expect(mockPrisma.marketOffer.updateMany).toHaveBeenCalledWith({
      where: { listingId: { in: ['lst_del'] }, status: OfferStatus.PENDING },
      data: {
        status: OfferStatus.REJECTED,
        cancelReason: 'Personagem não está mais anunciado',
        notifiedBuyer: false,
        buyerNotifiedStatus: 'REJECTED',
      },
    });
    expect(mockPrisma.marketListing.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['lst_del'] } },
      data: { status: ListingStatus.CANCELLED },
    });
  });

  it('getPendingRollNotification inclui motivo quando buyerNotifiedStatus é REJECTED', async () => {
    const mockPrisma: any = {
      marketOffer: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'off_1',
          buyerId: 'buyer_1',
          buyerNotifiedStatus: 'REJECTED',
          cancelReason: 'Personagem não está mais anunciado',
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const market = new MarketService(mockPrisma);
    const msg = await market.getPendingRollNotification('buyer_1');
    expect(msg).toContain('recusada');
    expect(msg).toContain('Personagem não está mais anunciado');
  });
});
