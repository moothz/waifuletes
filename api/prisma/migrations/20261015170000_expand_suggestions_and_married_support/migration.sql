-- AlterEnum
ALTER TYPE "SuggestionType" ADD VALUE IF NOT EXISTS 'NEW_CHARACTER';
ALTER TYPE "SuggestionType" ADD VALUE IF NOT EXISTS 'DELETE_CHARACTER';

-- AlterTable
ALTER TABLE "character_suggestions" ALTER COLUMN "characterId" DROP NOT NULL;
ALTER TABLE "character_suggestions" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "character_suggestions" ADD COLUMN IF NOT EXISTS "characterName" TEXT;
ALTER TABLE "character_suggestions" ADD COLUMN IF NOT EXISTS "series" TEXT;
ALTER TABLE "character_suggestions" ADD COLUMN IF NOT EXISTS "description" TEXT;
