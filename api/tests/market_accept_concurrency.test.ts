import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, ListingStatus, OfferStatus } from '@prisma/client';
import { MarketService } from '../src/services/MarketService.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

/**
 * Integração com PostgreSQL real: o aceite de propostas não pode entregar o mesmo personagem duas vezes
 * nem cobrar duas propostas do mesmo anúncio. Requer DATABASE_URL apontando para um banco de teste.
 */
const DATABASE_URL = process.env.DATABASE_URL?.replace('postgres:5432', '127.0.0.1:5433');

describe.skipIf(!DATABASE_URL)('🔒 Mercado — aceite concorrente de propostas', () => {
  let prisma: PrismaClient;
  let market: MarketService;

  const SUFFIX = Date.now().toString(36);
  const SELLER = `test_mkt_seller_${SUFFIX}`;
  const BUYER_A = `test_mkt_buyer_a_${SUFFIX}`;
  const BUYER_B = `test_mkt_buyer_b_${SUFFIX}`;
  const ALL_USERS = [SELLER, BUYER_A, BUYER_B];
  let characterId = '';
  const createdListingIds: string[] = [];

  async function createListingWithTwoOffers() {
    const listing = await prisma.marketListing.create({
      data: { userId: SELLER, characterId, interest: 'teste de concorrência' },
    });
    createdListingIds.push(listing.id);
    const offerA = await prisma.marketOffer.create({
      data: { listingId: listing.id, buyerId: BUYER_A, sellerId: SELLER, offeredItems: { zinthos: 100 } },
    });
    const offerB = await prisma.marketOffer.create({
      data: { listingId: listing.id, buyerId: BUYER_B, sellerId: SELLER, offeredItems: { zinthos: 200 } },
    });
    return { listing, offerA, offerB };
  }

  async function resetOwnership() {
    await prisma.haremEntry.deleteMany({ where: { characterId } });
    await prisma.haremEntry.create({ data: { userId: SELLER, characterId, claimedInGroup: 'test_group_mkt' } });
    await prisma.user.updateMany({ where: { id: { in: ALL_USERS } }, data: { kakera: 1000 } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    market = new MarketService(prisma);
    // Sem notificações reais durante o teste
    (market as any).notificationService = { notifyMarketEvent: async () => undefined };

    // Personagem próprio do teste (não disputa personagens com outras suítes em paralelo)
    characterId = `test_mkt_char_${SUFFIX}`;
    await prisma.character.create({
      data: { id: characterId, name: 'Personagem Teste Mercado', series: 'Testes', baseRarity: 'COMMON' } as any,
    });

    for (const id of ALL_USERS) {
      await prisma.user.create({ data: { id, name: id, kakera: 1000 } });
    }
  });

  afterAll(async () => {
    await prisma.marketOffer.deleteMany({ where: { listingId: { in: createdListingIds } } });
    await prisma.marketListing.deleteMany({ where: { id: { in: createdListingIds } } });
    await prisma.haremEntry.deleteMany({ where: { characterId, userId: { in: ALL_USERS } } });
    await prisma.kakeraTransaction.deleteMany({ where: { userId: { in: ALL_USERS } } });
    await prisma.userNotification.deleteMany({ where: { userId: { in: ALL_USERS } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ALL_USERS } } });
    await prisma.character.deleteMany({ where: { id: characterId } });
    await prisma.$disconnect();
  });

  it('dois aceites simultâneos no mesmo anúncio: no máximo um conclui e o estado fica consistente', async () => {
    await resetOwnership();
    const { offerA, offerB } = await createListingWithTwoOffers();

    const results = await Promise.allSettled([
      market.acceptOffer(SELLER, offerA.id),
      market.acceptOffer(SELLER, offerB.id),
    ]);

    const offers = await prisma.marketOffer.findMany({ where: { id: { in: [offerA.id, offerB.id] } } });
    const accepted = offers.filter((o) => o.status === OfferStatus.ACCEPTED);
    expect(accepted.length).toBeLessThanOrEqual(1);
    expect(offers.some((o) => o.status === OfferStatus.PROCESSING)).toBe(false);

    const owner = await prisma.haremEntry.findUnique({ where: { characterId } });
    const users = Object.fromEntries(
      (await prisma.user.findMany({ where: { id: { in: ALL_USERS } } })).map((u) => [u.id, u.kakera])
    );

    if (accepted.length === 1) {
      const winner = accepted[0];
      const paid = winner.id === offerA.id ? 100 : 200;
      expect(owner?.userId).toBe(winner.buyerId);
      expect(users[SELLER]).toBe(1000 + paid);
      expect(users[winner.buyerId]).toBe(1000 - paid);
      const loser = winner.buyerId === BUYER_A ? BUYER_B : BUYER_A;
      expect(users[loser]).toBe(1000);
    } else {
      // Ambos recusados por estarem em processamento simultâneo: nada muda
      expect(owner?.userId).toBe(SELLER);
      expect(users[SELLER]).toBe(1000);
      expect(results.every((r) => r.status === 'rejected' || (r.value as any)?.success === false)).toBe(true);
    }
  });

  it('anúncio reaberto por leitura defasada: a transação recusa mover um personagem que o vendedor não tem mais', async () => {
    await resetOwnership();
    const { listing, offerA, offerB } = await createListingWithTwoOffers();

    const first = await market.acceptOffer(SELLER, offerA.id);
    expect((first as any).success).not.toBe(false);
    expect((await prisma.haremEntry.findUnique({ where: { characterId } }))?.userId).toBe(BUYER_A);

    // Simula o cenário da corrida: o anúncio volta a aparecer como ACTIVE e a proposta B segue pendente
    await prisma.marketListing.update({ where: { id: listing.id }, data: { status: ListingStatus.ACTIVE } });
    await prisma.marketOffer.update({ where: { id: offerB.id }, data: { status: OfferStatus.PENDING } });

    const second = await market.acceptOffer(SELLER, offerB.id).catch((e) => ({ success: false, error: e }));
    expect((second as any).success).toBe(false);

    // O personagem continua com o comprador A e o comprador B não foi cobrado
    expect((await prisma.haremEntry.findUnique({ where: { characterId } }))?.userId).toBe(BUYER_A);
    const buyerB = await prisma.user.findUnique({ where: { id: BUYER_B } });
    expect(buyerB?.kakera).toBe(1000);
    const offerBAfter = await prisma.marketOffer.findUnique({ where: { id: offerB.id } });
    expect(offerBAfter?.status).not.toBe(OfferStatus.ACCEPTED);
    expect(offerBAfter?.status).not.toBe(OfferStatus.PROCESSING);
  });
});
