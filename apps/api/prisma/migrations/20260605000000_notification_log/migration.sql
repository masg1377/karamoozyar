-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INACTIVITY_SMS');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "adminId" TEXT,
    "conversationId" TEXT,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "NotificationStatus" NOT NULL DEFAULT 'SENT',
    "metadata" JSONB,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_logs_userId_type_sentAt_idx" ON "notification_logs"("userId", "type", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "notification_logs_adminId_type_sentAt_idx" ON "notification_logs"("adminId", "type", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "notification_logs_conversationId_idx" ON "notification_logs"("conversationId");

-- Add lastSeenAt to users for inactivity tracking
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
