-- Idempotency support for chat messages.
--
-- Adds a nullable `clientMessageId` to `messages` and a PARTIAL unique index
-- on (senderId, clientMessageId). The index only covers rows where
-- clientMessageId IS NOT NULL, so every historical row (which has NULL) stays
-- valid and no backfill is required. New rows always carry a clientMessageId,
-- so a given sender can never persist the same logical message twice — duplicate
-- CHAT_SEND emits (reconnect replay, manual retry) collapse to one row.
--
-- This migration is additive and non-destructive: no data is dropped or rewritten.

-- 1) Add the column (nullable — safe on a populated table).
ALTER TABLE "messages" ADD COLUMN "clientMessageId" TEXT;

-- 2) Partial unique index. NOTE: this is intentionally a PARTIAL index and is
--    therefore written by hand rather than via the default Prisma @@unique DDL
--    (which would build a plain composite unique that rejects >1 NULL pair only
--    on engines that treat NULLs as equal — Postgres treats NULLs as distinct,
--    but the partial predicate makes the intent explicit and index-efficient).
CREATE UNIQUE INDEX "messages_senderId_clientMessageId_key"
  ON "messages" ("senderId", "clientMessageId")
  WHERE "clientMessageId" IS NOT NULL;
