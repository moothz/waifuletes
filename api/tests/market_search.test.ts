import { describe, it, expect, vi } from 'vitest';
import { MarketService } from '../src/services/MarketService.js';
import { ListingStatus } from '@prisma/client';

describe('🔍 Busca Agressiva nos Classificados (Personagem, Anime e Procura)', () => {
  it('deve buscar termo único em nome, série e no texto de procura (interest)', async () => {
    const mockPrisma: any = {
      marketListing: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'list_1',
            userId: 'user_1',
            characterId: 'char_1',
            interest: 'Qualquer oferta de zinthos acima de 10k',
            status: ListingStatus.ACTIVE,
            createdAt: new Date(),
            user: { id: 'user_1', name: 'User 1', publicId: 'pub_1' },
            character: {
              id: 'char_1',
              name: 'Nami',
              series: 'One Piece',
              baseRarity: 'EPIC',
              _count: { wishlists: 5 },
              haremEntries: [{ userId: 'user_1', keys: 2, isFavorite: false }],
            },
          },
        ]),
      },
    };

    const marketService = new MarketService(mockPrisma);
    const result = await marketService.listGlobalListings({ search: 'zinthos' });

    expect(result.listings).toHaveLength(1);
    expect(mockPrisma.marketListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ListingStatus.ACTIVE,
          OR: [
            { character: { name: { contains: 'zinthos', mode: 'insensitive' } } },
            { character: { series: { contains: 'zinthos', mode: 'insensitive' } } },
            { interest: { contains: 'zinthos', mode: 'insensitive' } },
          ],
        }),
      })
    );
  });

  it('deve buscar múltiplos termos sem ordem de palavras usando AND com ORs de campos', async () => {
    const mockPrisma: any = {
      marketListing: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const marketService = new MarketService(mockPrisma);
    await marketService.listGlobalListings({ search: 'Piece One CountryBalls' });

    expect(mockPrisma.marketListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ListingStatus.ACTIVE,
          AND: [
            {
              OR: [
                { character: { name: { contains: 'Piece', mode: 'insensitive' } } },
                { character: { series: { contains: 'Piece', mode: 'insensitive' } } },
                { interest: { contains: 'Piece', mode: 'insensitive' } },
              ],
            },
            {
              OR: [
                { character: { name: { contains: 'One', mode: 'insensitive' } } },
                { character: { series: { contains: 'One', mode: 'insensitive' } } },
                { interest: { contains: 'One', mode: 'insensitive' } },
              ],
            },
            {
              OR: [
                { character: { name: { contains: 'CountryBalls', mode: 'insensitive' } } },
                { character: { series: { contains: 'CountryBalls', mode: 'insensitive' } } },
                { interest: { contains: 'CountryBalls', mode: 'insensitive' } },
              ],
            },
          ],
        }),
      })
    );
  });

  it('deve sanitizar vírgulas e múltiplos espaços na busca', async () => {
    const mockPrisma: any = {
      marketListing: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const marketService = new MarketService(mockPrisma);
    await marketService.listGlobalListings({ search: '  Solo,   Leveling;  Overgeared  ' });

    expect(mockPrisma.marketListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ListingStatus.ACTIVE,
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { interest: { contains: 'Solo', mode: 'insensitive' } },
              ]),
            }),
            expect.objectContaining({
              OR: expect.arrayContaining([
                { interest: { contains: 'Leveling', mode: 'insensitive' } },
              ]),
            }),
            expect.objectContaining({
              OR: expect.arrayContaining([
                { interest: { contains: 'Overgeared', mode: 'insensitive' } },
              ]),
            }),
          ]),
        }),
      })
    );
  });

  it('deve filtrar classificados por raridade combinada com busca sem quebrar contagem/listagem', async () => {
    const mockPrisma: any = {
      marketListing: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const marketService = new MarketService(mockPrisma);
    await marketService.listGlobalListings({ search: 'Persona', rarity: 'LEGENDARY' });

    const expectedWhere = {
      status: ListingStatus.ACTIVE,
      character: { baseRarity: 'LEGENDARY', isMythic: false },
      OR: [
        { character: { name: { contains: 'Persona', mode: 'insensitive' } } },
        { character: { series: { contains: 'Persona', mode: 'insensitive' } } },
        { interest: { contains: 'Persona', mode: 'insensitive' } },
      ],
    };
    expect(mockPrisma.marketListing.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(mockPrisma.marketListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere })
    );
  });

  it('deve filtrar raridade MYTHIC usando isMythic=true e ignorar raridade vazia', async () => {
    const mockPrisma: any = {
      marketListing: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const marketService = new MarketService(mockPrisma);
    await marketService.listGlobalListings({ rarity: 'MYTHIC' });
    expect(mockPrisma.marketListing.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { status: ListingStatus.ACTIVE, character: { isMythic: true } },
      })
    );

    await marketService.listGlobalListings({ rarity: '' });
    expect(mockPrisma.marketListing.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { status: ListingStatus.ACTIVE },
      })
    );
  });
});
