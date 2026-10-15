-- AlterTable: Add publicId to users with UUID generation
ALTER TABLE "users" ADD COLUMN "publicId" TEXT DEFAULT gen_random_uuid();
UPDATE "users" SET "publicId" = gen_random_uuid() WHERE "publicId" IS NULL;
ALTER TABLE "users" ALTER COLUMN "publicId" SET NOT NULL;
CREATE UNIQUE INDEX "users_publicId_key" ON "users"("publicId");

-- CreateEnum
CREATE TYPE "SuggestionType" AS ENUM ('RARITY', 'IMAGE');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "character_suggestions" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "SuggestionType" NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "currentRarity" "Rarity",
    "suggestedRarity" "Rarity",
    "reason" TEXT,
    "imageUrl" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "character_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "character_suggestions_status_createdAt_idx" ON "character_suggestions"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "character_suggestions_characterId_idx" ON "character_suggestions"("characterId");

-- CreateIndex
CREATE INDEX "character_suggestions_userId_idx" ON "character_suggestions"("userId");

-- AddForeignKey
ALTER TABLE "character_suggestions" ADD CONSTRAINT "character_suggestions_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_suggestions" ADD CONSTRAINT "character_suggestions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
