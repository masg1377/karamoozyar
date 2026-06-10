-- Update ReactionEmoji enum values
-- Remove old reactions that no longer exist (data cleanup)
DELETE FROM "newsletter_reactions" WHERE emoji::text NOT IN ('LIKE', 'DISLIKE', 'PRAY', 'OK', 'ROSE');

-- Add new enum values
ALTER TYPE "ReactionEmoji" ADD VALUE IF NOT EXISTS 'DISLIKE';
ALTER TYPE "ReactionEmoji" ADD VALUE IF NOT EXISTS 'PRAY';
ALTER TYPE "ReactionEmoji" ADD VALUE IF NOT EXISTS 'OK';
ALTER TYPE "ReactionEmoji" ADD VALUE IF NOT EXISTS 'ROSE';

-- PostgreSQL does not support DROP VALUE from enum directly.
-- Old values (LOVE, LAUGH, WOW, SAD, ANGRY) will remain in the type but are no longer used.
-- Any remaining rows with old values were deleted above.
