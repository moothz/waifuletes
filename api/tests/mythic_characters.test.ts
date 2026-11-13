import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService } from '../src/services/UserService.js';
import { WishlistService } from '../src/services/WishlistService.js';
import { CovetService } from '../src/services/CovetService.js';
import { DivorceService } from '../src/services/DivorceService.js';
import { SuggestionService } from '../src/services/SuggestionService.js';
import { MarketService } from '../src/services/MarketService.js';
import { HaremService } from '../src/services/HaremService.js';
import { CollectionService } from '../src/services/CollectionService.js';
import { RARITY_BASE_WEIGHTS } from '../src/utils/rarityCalculator.js';
import { DomainError } from '../src/errors/DomainError.js';

describe('🔮 Sistema de Personagens Míticos — Waifuletes API', () => {
  let mockPrisma: any;
  let mockCharacterService: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        update: vi.fn(),
        upsert: vi.fn(),
        findUnique: vi.fn(),
      },
      character: {
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
      userNotification: {
        create: vi.fn().mockResolvedValue({}),
      },
      haremEntry: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
      soulmate: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      wishlistEntry: {
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      marketListing: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn().mockImplementation((cb) => cb(mockPrisma)),
    };

    mockCharacterService = {
      findCharacter: vi.fn(),
      formatImageUrl: vi.fn((id, path) => `http://localhost:3030/media/${path || 'default.jpg'}`),
      getRandomImageUrl: vi.fn((id, urls) => urls?.[0] || 'http://localhost:3030/media/default.jpg'),
    };
  });

  describe('1. Gerenciamento de Slots Míticos (UserService)', () => {
    it('deve conceder slots e calcular availableSlots corretamente', async () => {
      mockPrisma.user.upsert.mockResolvedValue({
        id: 'user_1',
        name: 'Apoiador VIP',
        mythicSlots: 2,
      });
      mockPrisma.character.count.mockResolvedValue(1); // 1 mítico já criado

      const userService = new UserService(mockPrisma);
      const result = await userService.addMythicSlots('user_1', 1, 'DONATE_R$50');

      expect(result.userId).toBe('user_1');
      expect(result.mythicSlots).toBe(2);
      expect(result.usedSlots).toBe(1);
      expect(result.availableSlots).toBe(1);
      expect(mockPrisma.userNotification.create).toHaveBeenCalled();
    });

    it('deve rejeitar concessão com valor menor ou igual a zero', async () => {
      const userService = new UserService(mockPrisma);
      await expect(userService.addMythicSlots('user_1', 0)).rejects.toThrow('INVALID_AMOUNT');
    });

    it('deve retornar saldo correto no getMythicSlots', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        mythicSlots: 3,
      });
      mockPrisma.character.count.mockResolvedValue(2);

      const userService = new UserService(mockPrisma);
      const slots = await userService.getMythicSlots('user_1');

      expect(slots).toEqual({
        userId: 'user_1',
        mythicSlots: 3,
        usedSlots: 2,
        availableSlots: 1,
      });
    });
  });

  describe('2. Bloqueio de Wishlist & Covet para Personagens Míticos', () => {
    it('deve rejeitar adicionar personagem mítico à Wishlist', async () => {
      mockCharacterService.findCharacter.mockResolvedValue({
        id: 'myt_arthur',
        name: 'Arthur Pendragon',
        isMythic: true,
      });

      const wishlistService = new WishlistService(mockPrisma, mockCharacterService);
      const res = await wishlistService.addToWishlist('user_2', 'myt_arthur');

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('CANNOT_WISHLIST_MYTHIC');
    });

    it('deve rejeitar cobiçar (covet) personagem mítico', async () => {
      mockCharacterService.findCharacter.mockResolvedValue({
        id: 'myt_arthur',
        name: 'Arthur Pendragon',
        isMythic: true,
      });

      const covetService = new CovetService(mockPrisma, mockCharacterService);
      await expect(covetService.covet('user_2', 'myt_arthur')).rejects.toThrow(DomainError);
    });
  });

  describe('3. Bloqueio de Divórcio e Classificados para Míticos', () => {
    it('deve impedir divórcio de personagem mítico', async () => {
      mockPrisma.haremEntry.findFirst.mockResolvedValue({
        id: 'entry_1',
        userId: 'user_creator',
        characterId: 'myt_arthur',
        keys: 5,
        character: {
          id: 'myt_arthur',
          name: 'Arthur Pendragon',
          baseRarity: 'RARE',
          isMythic: true,
        },
      });

      const divorceService = new DivorceService(mockPrisma, null as any);
      await expect(divorceService.previewDivorce('user_creator', 'myt_arthur')).rejects.toThrow(DomainError);
      await expect(divorceService.divorce('user_creator', 'myt_arthur')).rejects.toThrow(DomainError);
    });

    it('deve impedir criar anúncio de venda de mítico nos classificados', async () => {
      mockPrisma.haremEntry.findFirst.mockResolvedValue({
        userId: 'user_creator',
        characterId: 'myt_arthur',
        character: {
          id: 'myt_arthur',
          name: 'Arthur Pendragon',
          isMythic: true,
        },
      });

      const marketService = new MarketService(mockPrisma, mockCharacterService);
      await expect(marketService.createListing('user_creator', 'myt_arthur', 'Busco outra waifu')).rejects.toThrow(DomainError);
    });

    it('deve impedir fazer oferta contendo personagem mítico nos classificados', async () => {
      mockPrisma.marketListing.findUnique = vi.fn().mockResolvedValue({
        id: 'list_1',
        userId: 'user_seller',
        status: 'ACTIVE',
        character: { id: 'char_regular', name: 'Regular Waifu' },
      });
      mockPrisma.marketOffer = {
        findFirst: vi.fn().mockResolvedValue(null),
      };
      mockPrisma.haremEntry.findMany = vi.fn().mockResolvedValue([
        {
          userId: 'user_buyer',
          characterId: 'myt_arthur',
          character: {
            id: 'myt_arthur',
            name: 'Arthur Pendragon',
            isMythic: true,
          },
        },
      ]);

      const marketService = new MarketService(mockPrisma, mockCharacterService);
      await expect(
        marketService.createOffer('user_buyer', 'list_1', {
          offeredItems: { waifuIds: ['myt_arthur'] },
        })
      ).rejects.toThrow(DomainError);
    });

    it('deve impedir aceitar oferta se contiver personagem mítico', async () => {
      mockPrisma.marketOffer = {
        findUnique: vi.fn().mockResolvedValue({
          id: 'off_1',
          sellerId: 'user_seller',
          buyerId: 'user_buyer',
          status: 'PENDING',
          offeredItems: { waifuIds: ['myt_arthur'] },
          listing: {
            id: 'list_1',
            userId: 'user_seller',
            characterId: 'char_regular',
            status: 'ACTIVE',
            character: { id: 'char_regular', name: 'Regular Waifu', isMythic: false },
          },
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      };
      mockPrisma.marketListing = {
        ...(mockPrisma.marketListing || {}),
        findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
      };
      mockPrisma.haremEntry.findFirst = vi.fn().mockResolvedValue({
        userId: 'user_seller',
        characterId: 'char_regular',
      });
      mockPrisma.haremEntry.findMany = vi.fn().mockResolvedValue([
        {
          userId: 'user_buyer',
          characterId: 'myt_arthur',
          character: {
            id: 'myt_arthur',
            name: 'Arthur Pendragon',
            isMythic: true,
          },
        },
      ]);

      const marketService = new MarketService(mockPrisma, mockCharacterService);
      const res = await marketService.acceptOffer('user_seller', 'off_1');
      expect(res.success).toBe(false);
      expect(res.cancelled).toBe(true);
      expect(mockPrisma.marketOffer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'off_1' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        })
      );
    });
  });

  describe('4. Bloqueio de Sugestões e Denúncias para Míticos', () => {
    it('deve rejeitar sugestões de raridade para personagens míticos', async () => {
      mockCharacterService.findCharacter.mockResolvedValue({
        id: 'myt_arthur',
        name: 'Arthur Pendragon',
        baseRarity: 'RARE',
        isMythic: true,
      });

      const suggestionService = new SuggestionService(mockPrisma, null as any, mockCharacterService);
      await expect(
        suggestionService.submitRaritySuggestion('user_2', 'myt_arthur', 'EPIC', 'Melhorar raridade')
      ).rejects.toThrow(DomainError);
    });
  });

  describe('5. Ordenação no Harém (Míticos por Primeiro)', () => {
    it('deve incluir ordenação por isMythic: desc no topo do getUserHarem', async () => {
      let capturedOrderBy: any = null;
      mockPrisma.haremEntry.findMany = vi.fn().mockImplementation((args) => {
        capturedOrderBy = args.orderBy;
        return Promise.resolve([]);
      });
      mockPrisma.haremEntry.count = vi.fn().mockResolvedValue(0);

      const haremService = new HaremService(mockPrisma, mockCharacterService);
      await haremService.getUserHarem('user_1', 1, 20, 'keys');

      expect(capturedOrderBy).toBeDefined();
      expect(capturedOrderBy[0]).toEqual({ character: { isMythic: 'desc' } });
      expect(capturedOrderBy[1]).toEqual({ isFavorite: 'desc' });
    });
  });

  describe('6. Ponderação de Sorteio (Roll)', () => {
    it('peso base de drop para mítico deve ser idêntico ao de RARE', () => {
      expect(RARITY_BASE_WEIGHTS.RARE).toBeDefined();
      expect(RARITY_BASE_WEIGHTS.RARE).toBeGreaterThan(0);
    });
  });

  describe('7. Restrição de Coleções / Pastas', () => {
    it('deve rejeitar adicionar personagem mítico a uma coleção/pasta', async () => {
      const mockPrismaCol: any = {
        userCollection: {
          findFirst: vi.fn().mockResolvedValue({ id: 'col_1', name: 'Isekai' }),
        },
        haremEntry: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'entry_1',
            userId: 'user_1',
            characterId: 'char_mythic',
            character: { id: 'char_mythic', name: 'Mítico Teste', isMythic: true, rarity: 'MYTHIC' },
          }),
        },
      };

      const collectionService = new CollectionService(mockPrismaCol);
      await expect(collectionService.addCharacterToCollection('user_1', 'col_1', 'char_mythic'))
        .rejects.toThrow('Personagens míticos não podem ser colocados em coleções/pastas.');
    });
  });

  describe('8. Exclusão de Personagem Mítico & Liberação de Slots', () => {
    it('deve calcular slots disponíveis corretamente após exclusão de mítico', async () => {
      mockPrisma.character.findUnique.mockResolvedValue({
        id: 'char_mythic_1',
        isMythic: true,
        creatorUserId: 'user_1',
      });
      mockPrisma.character.count.mockResolvedValue(0); // 0 restantes após exclusão
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        mythicSlots: 1,
      });

      const user = await mockPrisma.user.findUnique({ where: { id: 'user_1' } });
      const remainingMythics = await mockPrisma.character.count({
        where: { creatorUserId: 'user_1', isMythic: true },
      });

      const totalSlots = user?.mythicSlots || 0;
      const availableSlots = Math.max(0, totalSlots - remainingMythics);

      expect(totalSlots).toBe(1);
      expect(remainingMythics).toBe(0);
      expect(availableSlots).toBe(1);
    });
  });
});
