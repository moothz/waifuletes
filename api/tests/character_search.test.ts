import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CharacterService } from '../src/services/CharacterService.js';

describe('🔍 CharacterService.listCharacters — busca sem agressividade de descrição', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('busca termo único "persona" apenas em id, name e series (não em description)', async () => {
    let capturedCountArgs: any;
    let capturedFindManyArgs: any;

    const mockPrisma: any = {
      character: {
        count: vi.fn((args: any) => {
          capturedCountArgs = args;
          return Promise.resolve(1);
        }),
        findMany: vi.fn((args: any) => {
          capturedFindManyArgs = args;
          return Promise.resolve([
            {
              id: 'joker-persona-5',
              name: 'Joker',
              series: 'Persona 5',
              description: 'Protagonista dos Phantom Thieves.',
              baseRarity: 'LEGENDARY',
              isMythic: false,
              imageUrls: [],
              _count: { wishlists: 10 },
              creatorUser: null,
              haremEntries: [],
            },
          ]);
        }),
      },
    };

    const service = new CharacterService(mockPrisma, {} as any);
    const res = await service.listCharacters({ search: '  persona  ', sort: 'popularity' });

    expect(res.data).toHaveLength(1);
    expect(capturedCountArgs.where.OR).toEqual([
      { id: { contains: 'persona', mode: 'insensitive' } },
      { name: { contains: 'persona', mode: 'insensitive' } },
      { series: { contains: 'persona', mode: 'insensitive' } },
    ]);
    expect(JSON.stringify(capturedFindManyArgs.where)).not.toContain('description');
  });

  it('busca multi-termo "persona 5" e filtro explícito series funcionam sem consultar description', async () => {
    let capturedWhere: any;
    const mockPrisma: any = {
      character: {
        count: vi.fn((args: any) => {
          capturedWhere = args.where;
          return Promise.resolve(0);
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const service = new CharacterService(mockPrisma, {} as any);
    await service.listCharacters({ search: 'persona 5', series: 'Persona', sort: 'popularity' });

    expect(capturedWhere.series).toEqual({ contains: 'Persona', mode: 'insensitive' });
    expect(capturedWhere.AND).toEqual([
      {
        OR: [
          { id: { contains: 'persona', mode: 'insensitive' } },
          { name: { contains: 'persona', mode: 'insensitive' } },
          { series: { contains: 'persona', mode: 'insensitive' } },
        ],
      },
      {
        OR: [
          { id: { contains: '5', mode: 'insensitive' } },
          { name: { contains: '5', mode: 'insensitive' } },
          { series: { contains: '5', mode: 'insensitive' } },
        ],
      },
    ]);
    expect(JSON.stringify(capturedWhere)).not.toContain('description');
  });
});
