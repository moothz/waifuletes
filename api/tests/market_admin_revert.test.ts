import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketService } from '../src/services/MarketService.js';
import { ListingStatus, OfferStatus } from '@prisma/client';

describe('MarketService - Reversão Administrativa de Negociações', () => {
  let mockPrisma: any;
  let marketService: MarketService;

  beforeEach(() => {
    mockPrisma = {
      marketOffer: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      },
      marketListing: {
        update: vi.fn(),
      },
      haremEntry: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      characterCovet: {
        updateMany: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      kakeraTransaction: {
        createMany: vi.fn(),
      },
      character: {
        findMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
    };

    marketService = new MarketService(mockPrisma as any);
  });

  it('deve listar negociações para a aba do admin', async () => {
    mockPrisma.marketOffer.count.mockResolvedValue(1);
    mockPrisma.marketOffer.findMany.mockResolvedValue([
      {
        id: 'offer_1',
        listingId: 'list_1',
        status: OfferStatus.ACCEPTED,
        cancelReason: null,
        offeredItems: {
          zinthos: 50000,
          waifuIds: ['waifu_2'],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        listing: {
          interest: 'Ofertas',
          character: {
            id: 'waifu_1',
            name: 'Waifu 1',
            baseRarity: 'LEGENDARY',
            imageUrls: ['waifu1.jpg'],
          },
        },
        seller: { id: 'seller_1', name: 'Vendedor', publicId: 'v1', platform: 'WHATSAPP' },
        buyer: { id: 'buyer_1', name: 'Comprador', publicId: 'b1', platform: 'WHATSAPP' },
      },
    ]);
    mockPrisma.character.findMany.mockResolvedValue([
      {
        id: 'waifu_2',
        name: 'Waifu 2',
        baseRarity: 'RARE',
        imageUrls: ['waifu2.jpg'],
      },
    ]);

    const result = await marketService.listAdminTrades({ page: 1, limit: 10 });
    expect(result.pagination.total).toBe(1);
    expect(result.trades.length).toBe(1);
    expect(result.trades[0].id).toBe('offer_1');
    expect(result.trades[0].character.name).toBe('Waifu 1');
    expect(result.trades[0].offeredItems.offeredWaifus[0].name).toBe('Waifu 2');
  });

  it('deve reverter com sucesso uma negociação aceita', async () => {
    const mockOffer = {
      id: 'offer_1',
      sellerId: 'seller_1',
      buyerId: 'buyer_1',
      status: OfferStatus.ACCEPTED,
      cancelReason: null,
      offeredItems: {
        zinthos: 10000,
        waifuIds: ['waifu_2'],
      },
      listing: {
        id: 'list_1',
        characterId: 'waifu_1',
        character: { id: 'waifu_1', name: 'Waifu 1' },
        user: { id: 'seller_1', name: 'Vendedor' },
      },
      seller: { id: 'seller_1', name: 'Vendedor' },
      buyer: { id: 'buyer_1', name: 'Comprador' },
    };

    mockPrisma.marketOffer.findUnique.mockResolvedValue(mockOffer);

    // 1. Comprador possui Waifu 1
    mockPrisma.haremEntry.findFirst.mockResolvedValue({
      userId: 'buyer_1',
      characterId: 'waifu_1',
    });

    // 2. Vendedor possui Waifu 2
    mockPrisma.haremEntry.findMany.mockResolvedValue([
      { userId: 'seller_1', characterId: 'waifu_2' },
    ]);

    // 3. Vendedor tem Zinthos suficientes
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'seller_1',
      kakera: 25000,
    });

    const result = await marketService.revertOffer('offer_1');
    expect(result.success).toBe(true);
    expect(result.message).toContain('Negociação revertida com sucesso');

    // Verifica se Waifu 1 voltou para o vendedor
    expect(mockPrisma.haremEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { characterId: 'waifu_1' },
        data: expect.objectContaining({ userId: 'seller_1' }),
      })
    );

    // Verifica se Waifu 2 voltou para o comprador
    expect(mockPrisma.haremEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { characterId: 'waifu_2' },
        data: expect.objectContaining({ userId: 'buyer_1' }),
      })
    );

    // Verifica se o anúncio voltou para ACTIVE
    expect(mockPrisma.marketListing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'list_1' },
        data: { status: ListingStatus.ACTIVE },
      })
    );

    // Verifica se a oferta foi marcada como CANCELLED com motivo Revertida
    expect(mockPrisma.marketOffer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'offer_1' },
        data: expect.objectContaining({
          status: OfferStatus.CANCELLED,
          cancelReason: 'Revertida pelo administrador.',
        }),
      })
    );

    // Verifica se ofertas auto-recusadas foram restauradas para PENDING
    expect(mockPrisma.marketOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          listingId: 'list_1',
          cancelReason: 'Personagem não está mais anunciado',
        },
        data: expect.objectContaining({
          status: OfferStatus.PENDING,
          cancelReason: null,
        }),
      })
    );
  });

  it('deve recusar reversão se o comprador não possui mais o personagem anunciado', async () => {
    mockPrisma.marketOffer.findUnique.mockResolvedValue({
      id: 'offer_1',
      sellerId: 'seller_1',
      buyerId: 'buyer_1',
      status: OfferStatus.ACCEPTED,
      listing: {
        id: 'list_1',
        characterId: 'waifu_1',
        character: { id: 'waifu_1', name: 'Waifu 1' },
      },
      seller: { id: 'seller_1', name: 'Vendedor' },
      buyer: { id: 'buyer_1', name: 'Comprador' },
    });

    // Comprador NÃO possui mais Waifu 1
    mockPrisma.haremEntry.findFirst.mockResolvedValue(null);

    await expect(marketService.revertOffer('offer_1')).rejects.toThrow('não possui mais o personagem');
  });

  it('deve recusar reversão se o vendedor não tem Zinthos suficientes para o estorno', async () => {
    mockPrisma.marketOffer.findUnique.mockResolvedValue({
      id: 'offer_1',
      sellerId: 'seller_1',
      buyerId: 'buyer_1',
      status: OfferStatus.ACCEPTED,
      offeredItems: { zinthos: 100000 },
      listing: {
        id: 'list_1',
        characterId: 'waifu_1',
        character: { id: 'waifu_1', name: 'Waifu 1' },
      },
      seller: { id: 'seller_1', name: 'Vendedor' },
      buyer: { id: 'buyer_1', name: 'Comprador' },
    });

    mockPrisma.haremEntry.findFirst.mockResolvedValue({
      userId: 'buyer_1',
      characterId: 'waifu_1',
    });

    // Vendedor só tem 5000 Zinthos
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'seller_1',
      kakera: 5000,
    });

    await expect(marketService.revertOffer('offer_1')).rejects.toThrow('possui apenas 5000 Zinthos');
  });
});
