-- CreateTable: user_collections
CREATE TABLE IF NOT EXISTS "user_collections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_collections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_collections_user_id_name_key" ON "user_collections"("user_id", "name");
CREATE INDEX IF NOT EXISTS "user_collections_user_id_idx" ON "user_collections"("user_id");

-- AddForeignKey
ALTER TABLE "user_collections" DROP CONSTRAINT IF EXISTS "user_collections_user_id_fkey";
ALTER TABLE "user_collections" ADD CONSTRAINT "user_collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Adicionar collection_id em harem_entries
ALTER TABLE "harem_entries" ADD COLUMN IF NOT EXISTS "collection_id" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "harem_entries_collection_id_idx" ON "harem_entries"("collection_id");

-- AddForeignKey
ALTER TABLE "harem_entries" DROP CONSTRAINT IF EXISTS "harem_entries_collection_id_fkey";
ALTER TABLE "harem_entries" ADD CONSTRAINT "harem_entries_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "user_collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
