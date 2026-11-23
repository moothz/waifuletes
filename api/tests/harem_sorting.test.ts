import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HaremService } from '../src/services/HaremService.js';

describe('Harem Sorting — Soulmates e Raridades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve ordenar Soulmates no topo acima de Lendários e Épicos quando limit=0', async () => {
    const mockEntries = [
      {
        id: 'entry-legendary',
        characterId: 'char-legendary',
        userId: 'user-1',
        claimedAt: new Date(),
        claimedInGroup: 'group-1',
        keys: 1,
        isFavorite: false,
        isLocked: false,
        note: null,
        collectionId: null,
        collection: null,
        pinnedPhoto: null,
        character: {
          id: 'char-legendary',
          name: 'Waifu Lendária',
          series: 'Anime A',
          baseRarity: 'LEGENDARY',
          isMythic: false,
          imageUrls: ['img1.jpg'],
          claimCount: 50,
          _count: { wishlists: 10 },
        },
      },
      {
        id: 'entry-soulmate-common',
        characterId: 'char-soulmate-common',
        userId: 'user-1',
        claimedAt: new Date(),
        claimedInGroup: 'group-1',
        keys: 10,
        isFavorite: false,
        isLocked: false,
        note: null,
        collectionId: null,
        collection: null,
        pinnedPhoto: null,
        character: {
          id: 'char-soulmate-common',
          name: 'Waifu Soulmate Comum',
          series: 'Anime B',
          baseRarity: 'COMMON',
          isMythic: false,
          imageUrls: ['img2.jpg'],
          claimCount: 5,
          _count: { wishlists: 2 },
        },
      },
      {
        id: 'entry-epic',
        characterId: 'char-epic',
        userId: 'user-1',
        claimedAt: new Date(),
        claimedInGroup: 'group-1',
        keys: 3,
        isFavorite: false,
        isLocked: false,
        note: null,
        collectionId: null,
        collection: null,
        pinnedPhoto: null,
        character: {
          id: 'char-epic',
          name: 'Waifu Épica',
          series: 'Anime C',
          baseRarity: 'EPIC',
          isMythic: false,
          imageUrls: ['img3.jpg'],
          claimCount: 20,
          _count: { wishlists: 5 },
        },
      },
      {
        id: 'entry-soulmate-rare',
        characterId: 'char-soulmate-rare',
        userId: 'user-1',
        claimedAt: new Date(),
        claimedInGroup: 'group-1',
        keys: 15,
        isFavorite: true,
        isLocked: false,
        note: null,
        collectionId: null,
        collection: null,
        pinnedPhoto: null,
        character: {
          id: 'char-soulmate-rare',
          name: 'Waifu Soulmate Rara Favorita',
          series: 'Anime D',
          baseRarity: 'RARE',
          isMythic: false,
          imageUrls: ['img4.jpg'],
          claimCount: 15,
          _count: { wishlists: 8 },
        },
      },
    ];

    const mockPrisma: any = {
      haremEntry: {
        findMany: vi.fn().mockResolvedValue(mockEntries),
        count: vi.fn().mockResolvedValue(mockEntries.length),
      },
      soulmate: {
        findMany: vi.fn().mockResolvedValue([{ characterId: 'char-soulmate-common' }, { characterId: 'char-soulmate-rare' }]),
      },
    };
    const mockCharService: any = {
      formatImageUrl: vi.fn((_id, u) => u),
      getRandomImageUrl: vi.fn((_id, imgs) => imgs?.[0] || ''),
    };

    const service = new HaremService(mockPrisma, mockCharService);
    const result = await service.getUserHarem('user-1', 1, 0, 'keys');

    expect(result.data).toHaveLength(4);

    // Soulmate favorita deve vir primeiro
    expect(result.data[0].id).toBe('entry-soulmate-rare');
    expect(result.data[0].isSoulmate).toBe(true);

    // Segunda Soulmate (comum, 10 chaves)
    expect(result.data[1].id).toBe('entry-soulmate-common');
    expect(result.data[1].isSoulmate).toBe(true);

    // Em seguida, os não-soulmates por raridade: Lendário > Épico
    expect(result.data[2].id).toBe('entry-legendary');
    expect(result.data[2].isSoulmate).toBe(false);

    expect(result.data[3].id).toBe('entry-epic');
    expect(result.data[3].isSoulmate).toBe(false);
  });
});
