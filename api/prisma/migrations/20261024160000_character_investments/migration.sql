-- AlterEnum
ALTER TYPE "KakeraReason" ADD VALUE IF NOT EXISTS 'MARKET_BUY';
ALTER TYPE "KakeraReason" ADD VALUE IF NOT EXISTS 'MARKET_REFUND';

-- CreateTable
CREATE TABLE IF NOT EXISTS "character_investments" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL DEFAULT 1,
    "totalZinthos" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "character_investments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "character_investments_characterId_userId_key" ON "character_investments"("characterId", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "character_investments_userId_idx" ON "character_investments"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "character_investments_characterId_idx" ON "character_investments"("characterId");

-- AddForeignKey
ALTER TABLE "character_investments" DROP CONSTRAINT IF EXISTS "character_investments_characterId_fkey";
ALTER TABLE "character_investments" ADD CONSTRAINT "character_investments_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "character_investments" DROP CONSTRAINT IF EXISTS "character_investments_userId_fkey";
ALTER TABLE "character_investments" ADD CONSTRAINT "character_investments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
