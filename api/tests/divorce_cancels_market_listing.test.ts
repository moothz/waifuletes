import { describe, it, expect, beforeEach } from 'vitest';
import { DivorceService } from '../src/services/DivorceService.js';

/**
 * Regra de negócio: ao divorciar (ou forçar divórcio), o anúncio do personagem nos
 * classificados deve deixar de existir, pois o usuário não é mais o dono.
 */
describe('💔 Divórcio encerra anúncios nos classificados', () => {
  let calls: any[];
  let activeListings: Array<{ id: string }>;

  function buildMockPrisma(): any {
    const tx: any = {
      haremEntry: {
        delete: async () => ({ id: 'harem_1' }),
        deleteMany: async () => ({ count: 1 }),
      },
      soulmate: {
        delete: async () => ({ id: 'soul_1' }),
        deleteMany: async () => ({ count: 0 }),
      },
      user: {
        update: async (_args: any) => ({ kakera: 5000 }),
      },
      kakeraTransaction: {
        create: async () => ({}),
      },
      marketListing: {
        findMany: async (args: any) => {
          calls.push({ op: 'listing.findMany', ...args });
          return activeListings;
        },
        updateMany: async (args: any) => {
          calls.push({ op: 'listing.updateMany', ...args });
          return { count: args?.where?.id?.in?.length ?? 0 };
        },
      },
      marketOffer: {
        updateMany: async (args: any) => {
          calls.push({ op: 'offer.updateMany', ...args });
          return { count: 2 };
        },
      },
      $executeRaw: async () => 1,
    };

    return {
      $transaction: async (cb: any) => cb(tx),
      $queryRaw: async () => [{ count: BigInt(0) }],
      haremEntry: {
        findFirst: async () => ({
          id: 'harem_1',
          userId: 'user1',
          characterId: 'char_makima',
          keys: 2,
          character: {
            id: 'char_makima',
            name: 'Makima',
            baseRarity: 'EPIC',
          },
        }),
      },
      soulmate: {
        findUnique: async () => null,
      },
      user: {
        aggregate: async () => ({ _sum: { kakera: 1000000 } }),
      },
    };
  }

  beforeEach(() => {
    calls = [];
    activeListings = [{ id: 'listing_1' }];
  });

  it('deve cancelar o anúncio ativo e as ofertas pendentes no divórcio', async () => {
    const service = new DivorceService(buildMockPrisma(), undefined, undefined);

    const result = await service.divorce('user1', 'char_makima');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cancelledListings).toBe(1);

    const offerCancel = calls.find((c) => c.op === 'offer.updateMany');
    expect(offerCancel).toBeDefined();
    expect(offerCancel.where).toEqual({
      listingId: { in: ['listing_1'] },
      status: 'PENDING',
    });
    expect(offerCancel.data.status).toBe('REJECTED');
    expect(offerCancel.data.buyerNotifiedStatus).toBe('REJECTED');
    expect(offerCancel.data.notifiedBuyer).toBe(false);
    expect(offerCancel.data.cancelReason).toBe('Personagem não está mais anunciado');

    const listingCancel = calls.find((c) => c.op === 'listing.updateMany');
    expect(listingCancel).toBeDefined();
    expect(listingCancel.where).toEqual({ id: { in: ['listing_1'] } });
    expect(listingCancel.data).toEqual({ status: 'CANCELLED' });
  });

  it('deve buscar apenas anúncios ATIVOS do próprio usuário para o personagem divorciado', async () => {
    const service = new DivorceService(buildMockPrisma(), undefined, undefined);

    await service.divorce('user1', 'char_makima');

    const find = calls.find((c) => c.op === 'listing.findMany');
    expect(find).toBeDefined();
    expect(find.where).toEqual({
      userId: 'user1',
      characterId: 'char_makima',
      status: 'ACTIVE',
    });
  });

  it('não deve chamar cancelamento quando não há anúncio ativo', async () => {
    activeListings = [];
    const service = new DivorceService(buildMockPrisma(), undefined, undefined);

    const result = await service.divorce('user1', 'char_makima');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cancelledListings).toBe(0);
    expect(calls.filter((c) => c.op === 'listing.updateMany')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'offer.updateMany')).toHaveLength(0);
  });

  it('deve cancelar o anúncio também no forceDivorce administrativo', async () => {
    const service = new DivorceService(buildMockPrisma(), undefined, undefined);

    const result = await service.forceDivorce('user1', 'char_makima');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cancelledListings).toBe(1);

    const listingCancel = calls.find((c) => c.op === 'listing.updateMany');
    expect(listingCancel).toBeDefined();
    expect(listingCancel.data).toEqual({ status: 'CANCELLED' });
  });
});
