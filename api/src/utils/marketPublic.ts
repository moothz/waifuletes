/**
 * Sanitizadores das respostas web do mercado (CLAUDE.md §3.2 — PII).
 *
 * O MarketService devolve objetos do Prisma com ids internos (JID/telefone) em `userId`, `sellerId`,
 * `buyerId`, `user.id`, `buyer.id`, `character.haremEntries[].userId` e `character.creatorUserId`.
 * A rota privada do bot (autenticada por API key) pode recebê-los; as rotas web não — elas atendem
 * visitantes anônimos e jogadores que não devem ver o telefone da outra parte.
 */

type AnyRecord = Record<string, any>;

function publicPerson(person: AnyRecord | null | undefined) {
  if (!person) return person ?? null;
  return { name: person.name ?? null, publicId: person.publicId ?? null };
}

export function toPublicCharacter(character: AnyRecord | null | undefined) {
  if (!character || typeof character !== 'object') return character;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { haremEntries, creatorUserId, ...rest } = character;
  return rest;
}

export function toPublicListing(listing: AnyRecord | null | undefined) {
  if (!listing || typeof listing !== 'object') return listing;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { userId, user, character, ...rest } = listing;
  return {
    ...rest,
    ...(user !== undefined ? { user: publicPerson(user) } : {}),
    ...(character !== undefined ? { character: toPublicCharacter(character) } : {}),
  };
}

export function toPublicOffer(offer: AnyRecord | null | undefined) {
  if (!offer || typeof offer !== 'object') return offer;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { buyerId, sellerId, buyer, seller, listing, ...rest } = offer;
  const offeredItems = rest.offeredItems && typeof rest.offeredItems === 'object'
    ? {
        ...rest.offeredItems,
        ...(Array.isArray(rest.offeredItems.waifus)
          ? { waifus: rest.offeredItems.waifus.map((w: AnyRecord) => toPublicCharacter(w)) }
          : {}),
      }
    : rest.offeredItems;
  return {
    ...rest,
    offeredItems,
    ...(buyer !== undefined ? { buyer: publicPerson(buyer) } : {}),
    ...(seller !== undefined ? { seller: publicPerson(seller) } : {}),
    ...(listing !== undefined ? { listing: toPublicListing(listing) } : {}),
  };
}
