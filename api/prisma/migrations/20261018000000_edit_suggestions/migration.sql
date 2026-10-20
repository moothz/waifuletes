-- AlterEnum
ALTER TYPE "SuggestionType" ADD VALUE IF NOT EXISTS 'EDIT';

-- AlterTable
ALTER TABLE "character_suggestions" ADD COLUMN IF NOT EXISTS "suggestedName" TEXT;
ALTER TABLE "character_suggestions" ADD COLUMN IF NOT EXISTS "suggestedSeries" TEXT;
ALTER TABLE "character_suggestions" ADD COLUMN IF NOT EXISTS "suggestedDescription" TEXT;
ALTER TABLE "character_suggestions" ADD COLUMN IF NOT EXISTS "suggestedGender" "Gender";
ALTER TABLE "character_suggestions" ADD COLUMN IF NOT EXISTS "suggestedTags" TEXT[] DEFAULT ARRAY[]::TEXT[];