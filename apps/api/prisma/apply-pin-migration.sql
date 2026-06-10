-- KarAmoozYar — Apply pin migration manually
-- Run this if `prisma migrate dev` is not available.
-- After running this, also run: npx prisma generate

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "pinnedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pinnedBy"  TEXT;

CREATE INDEX IF NOT EXISTS "messages_conversationId_pinnedAt_idx"
  ON "messages"("conversationId", "pinnedAt" DESC);

-- Add lastSeenAt to users (from previous migration, apply if missing)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'messages'
  AND column_name IN ('pinnedAt', 'pinnedBy');
