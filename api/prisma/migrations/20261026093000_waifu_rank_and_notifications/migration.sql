-- AlterTable: Adicionar popularityScore e waifuRank em characters
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "popularityScore" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "waifuRank" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "characters_popularityScore_idx" ON "characters"("popularityScore" DESC);
CREATE INDEX IF NOT EXISTS "characters_waifuRank_idx" ON "characters"("waifuRank");

-- CreateEnum: NotificationType
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationType') THEN
        CREATE TYPE "NotificationType" AS ENUM (
            'CHARACTER_UPDATED',
            'MARKET_OFFER_RECEIVED',
            'MARKET_OFFER_ACCEPTED',
            'MARKET_OFFER_REJECTED',
            'MARKET_LISTING_MATCH',
            'COVET_RECEIVED',
            'SUGGESTION_APPROVED',
            'SUGGESTION_REJECTED',
            'SYSTEM'
        );
    END IF;
END $$;

-- CreateTable: user_notifications
CREATE TABLE IF NOT EXISTS "user_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_notifications_user_id_is_read_created_at_idx" ON "user_notifications"("user_id", "is_read", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "user_notifications" DROP CONSTRAINT IF EXISTS "user_notifications_user_id_fkey";
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
