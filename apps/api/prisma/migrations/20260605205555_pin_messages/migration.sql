/*
  Warnings:

  - The values [LOVE,LAUGH,WOW,SAD,ANGRY] on the enum `ReactionEmoji` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ReactionEmoji_new" AS ENUM ('LIKE', 'DISLIKE', 'PRAY', 'OK', 'ROSE');
ALTER TABLE "newsletter_reactions" ALTER COLUMN "emoji" TYPE "ReactionEmoji_new" USING ("emoji"::text::"ReactionEmoji_new");
ALTER TYPE "ReactionEmoji" RENAME TO "ReactionEmoji_old";
ALTER TYPE "ReactionEmoji_new" RENAME TO "ReactionEmoji";
DROP TYPE "public"."ReactionEmoji_old";
COMMIT;
