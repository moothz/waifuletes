-- 1. Reconcile claimCount discrepancies before adding indexes/constraints
UPDATE "characters" c
SET "claimCount" = COALESCE(h.actual, 0)
FROM (
  SELECT c2.id, COUNT(he.id) as actual
  FROM "characters" c2
  LEFT JOIN "harem_entries" he ON c2.id = he."characterId"
  GROUP BY c2.id
) h
WHERE c.id = h.id AND c."claimCount" != h.actual;

-- 2. Unique constraint for global character ownership (D4)
CREATE UNIQUE INDEX IF NOT EXISTS "harem_entries_characterId_key" ON "harem_entries"("characterId");

-- 3. Check constraint to ensure kakera balance never goes negative (D5)
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_kakera_non_negative";
ALTER TABLE "users" ADD CONSTRAINT "users_kakera_non_negative" CHECK ("kakera" >= 0);

-- 4. Foreign key and filtering indexes (E2)
CREATE INDEX IF NOT EXISTS "harem_entries_userId_idx" ON "harem_entries"("userId");
CREATE INDEX IF NOT EXISTS "wishlist_entries_userId_idx" ON "wishlist_entries"("userId");
CREATE INDEX IF NOT EXISTS "wishlist_entries_characterId_idx" ON "wishlist_entries"("characterId");
CREATE INDEX IF NOT EXISTS "kakera_transactions_userId_createdAt_idx" ON "kakera_transactions"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "users_kakera_idx" ON "users"("kakera" DESC);
CREATE INDEX IF NOT EXISTS "characters_claimCount_likeCount_idx" ON "characters"("claimCount" DESC, "likeCount" DESC);
CREATE INDEX IF NOT EXISTS "characters_baseRarity_claimCount_idx" ON "characters"("baseRarity", "claimCount" DESC);

-- 5. Full text search and trigram extension (E2)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "idx_characters_name_trgm" ON "characters" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_characters_series_trgm" ON "characters" USING gin ("series" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_characters_id_trgm" ON "characters" USING gin ("id" gin_trgm_ops);

-- 6. Partial indexes for active characters
CREATE INDEX IF NOT EXISTS "idx_characters_active_claim_like" ON "characters" ("claimCount" DESC, "likeCount" DESC) WHERE "isActive" = true;
CREATE INDEX IF NOT EXISTS "idx_characters_active_rarity" ON "characters" ("baseRarity", "claimCount" DESC) WHERE "isActive" = true;
