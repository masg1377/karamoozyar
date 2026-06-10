-- ============================================================
-- Migration: 20260603000000_user_profile_and_reply
-- Adds: Gender enum, extended user profile fields,
--       message reply self-relation
-- ============================================================

-- 1. Create Gender enum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- 2. Extend users table with profile fields
ALTER TABLE "users"
  ADD COLUMN "fatherName"               TEXT,
  ADD COLUMN "birthCertificateNumber"   TEXT,
  ADD COLUMN "birthDate"                TIMESTAMP(3),
  ADD COLUMN "gender"                   "Gender",
  ADD COLUMN "residenceProvince"        TEXT,
  ADD COLUMN "residenceCity"            TEXT,
  ADD COLUMN "profileImageAttachmentId" TEXT;

-- 3. Add reply support to messages
ALTER TABLE "messages"
  ADD COLUMN "replyToMessageId" TEXT;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_replyToMessageId_fkey"
  FOREIGN KEY ("replyToMessageId")
  REFERENCES "messages"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "messages_replyToMessageId_idx" ON "messages"("replyToMessageId");
