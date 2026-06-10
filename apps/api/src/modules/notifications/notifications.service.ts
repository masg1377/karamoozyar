/**
 * NotificationsService
 *
 * Runs a scheduled job every hour to find users/admins with:
 *   - unread messages in a conversation
 *   - lastSeenAt older than 24 hours (or never opened)
 *
 * Sends one SMS per (recipient, conversation) per 24-hour window.
 * Stores every send attempt in NotificationLog to prevent spam.
 *
 * NOTE: This service uses `(this.prisma as any)` for the new models
 * (NotificationLog, lastSeenAt on User) until `prisma generate` is
 * run after the next migration deploy.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsProviderService } from './sms.provider';

const INACTIVITY_HOURS = 24;
const SMS_TEXT =
  'شما یک پیام خوانده‌نشده در سامانه کارآموزیار دارید. برای مشاهده وارد سامانه شوید.';

// Convenience alias so we don't scatter casts everywhere
const anyPrisma = (p: PrismaService): any => p as any; // eslint-disable-line @typescript-eslint/no-explicit-any

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsProviderService,
  ) {}

  /** Runs every hour */
  @Cron(CronExpression.EVERY_HOUR)
  async handleInactivityNotifications(): Promise<void> {
    this.logger.log('⏰ Running inactivity notification check...');
    const threshold = new Date(Date.now() - INACTIVITY_HOURS * 60 * 60 * 1000);

    await Promise.all([
      this.notifyInactiveUsers(threshold),
      this.notifyInactiveAdmins(threshold),
    ]);
  }

  /**
   * Notify trainees who have unread messages and haven't been active in 24h.
   */
  private async notifyInactiveUsers(threshold: Date): Promise<void> {
    const db = anyPrisma(this.prisma);
    const conversations = await db.conversation.findMany({
      where: {
        unreadByUser: { gt: 0 },
        user: {
          isActive: true,
          deletedAt: null,
          phoneNumber: { not: null },
          OR: [
            { lastSeenAt: null },
            { lastSeenAt: { lt: threshold } },
          ],
        },
      },
      include: {
        user: { select: { id: true, phoneNumber: true, lastSeenAt: true } },
      },
    });

    for (const conv of conversations) {
      const user = conv.user as { id: string; phoneNumber: string; lastSeenAt: Date | null };
      if (!user.phoneNumber) continue;

      await this.sendIfNotAlreadySent({
        userId: user.id,
        conversationId: conv.id,
        phone: user.phoneNumber,
      });
    }
  }

  /**
   * Notify admins who have unread messages and haven't been active in 24h.
   */
  private async notifyInactiveAdmins(threshold: Date): Promise<void> {
    const db = anyPrisma(this.prisma);
    const conversations = await db.conversation.findMany({
      where: { unreadByAdmin: { gt: 0 } },
    });

    if (conversations.length === 0) return;

    // Find all active admins who haven't been seen in 24h
    const admins = await db.user.findMany({
      where: {
        role: 'ADMIN',
        isActive: true,
        deletedAt: null,
        phoneNumber: { not: null },
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: threshold } }],
      },
      select: { id: true, phoneNumber: true },
    });

    for (const admin of admins) {
      if (!admin.phoneNumber) continue;
      await this.sendIfNotAlreadySent({
        adminId: admin.id,
        conversationId: null,
        phone: admin.phoneNumber,
      });
    }
  }

  private async sendIfNotAlreadySent(opts: {
    userId?: string;
    adminId?: string;
    conversationId: string | null;
    phone: string;
  }): Promise<void> {
    const db = anyPrisma(this.prisma);
    const since24h = new Date(Date.now() - INACTIVITY_HOURS * 60 * 60 * 1000);

    // Check for existing log in last 24h — one per recipient+conversation
    const existing = await db.notificationLog.findFirst({
      where: {
        type: 'INACTIVITY_SMS',
        channel: 'SMS',
        ...(opts.userId ? { userId: opts.userId } : {}),
        ...(opts.adminId ? { adminId: opts.adminId } : {}),
        ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
        sentAt: { gt: since24h },
      },
    });

    if (existing) return; // Already sent within 24h — do not spam

    // Send SMS
    const result = await this.sms.send({ to: opts.phone, message: SMS_TEXT });

    // Persist log entry regardless of success/failure
    await db.notificationLog.create({
      data: {
        userId: opts.userId ?? null,
        adminId: opts.adminId ?? null,
        conversationId: opts.conversationId ?? null,
        type: 'INACTIVITY_SMS',
        channel: 'SMS',
        status: result.success ? 'SENT' : 'FAILED',
        metadata: { messageId: result.messageId, error: result.error ?? null },
      },
    });

    if (result.success) {
      this.logger.log(`📨 SMS sent to ${opts.phone} (user=${opts.userId ?? opts.adminId})`);
    } else {
      this.logger.warn(`❌ SMS failed for ${opts.phone}: ${result.error}`);
    }
  }

  /**
   * Call this when a user/admin opens a conversation to update lastSeenAt.
   */
  async markUserSeen(userId: string): Promise<void> {
    await anyPrisma(this.prisma).user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    });
  }
}
