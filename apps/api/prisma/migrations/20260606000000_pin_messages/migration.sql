-- Add pin support to messages table
ALTER TABLE "messages"
  ADD COLUMN "pinnedAt"  TIMESTAMP(3),
  ADD COLUMN "pinnedBy"  TEXT;

-- Index for fast pinned-message queries per conversation
CREATE INDEX "messages_conversationId_pinnedAt_idx"
  ON "messages"("conversationId", "pinnedAt" DESC);
