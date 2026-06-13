import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import {
  SOCKET_EVENTS,
  SOCKET_ROOMS,
  type PushSubscriptionDto,
  type SocketNotificationPayload,
} from '@karamooziyar/shared';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { sendWebPush, type VapidKeys } from './web-push.util';

/** Payload delivered to the service worker (must stay small) */
export interface PushNotificationPayload {
  title: string;
  body: string;
  /** in-app route to open on click */
  url: string;
  /** collapses notifications of the same context */
  tag?: string;
}

type RoomEmitter = (room: string, event: string, payload: unknown) => void;

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly vapid: VapidKeys;
  /** Bound by ChatGateway after init — lets non-gateway modules emit socket events */
  private emitToRoom: RoomEmitter | null = null;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.vapid = configService.get('push', { infer: true });
  }

  // ─── Socket bridge ───────────────────────────────────────────────────────────

  registerSocketEmitter(emitter: RoomEmitter): void {
    this.emitToRoom = emitter;
  }

  // ─── Subscription management ────────────────────────────────────────────────

  getPublicKey(): string {
    return this.vapid.publicKey;
  }

  async subscribe(userId: string, dto: PushSubscriptionDto, userAgent?: string): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: userAgent ?? null,
      },
      // Endpoint can be re-registered by another account on the same device
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent: userAgent ?? null },
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  // ─── Delivery ────────────────────────────────────────────────────────────────

  async sendToUser(userId: string, payload: PushNotificationPayload): Promise<void> {
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    await this.deliver(subs, payload);
  }

  async sendToAdmins(payload: PushNotificationPayload): Promise<void> {
    const subs = await this.prisma.pushSubscription.findMany({
      where: { user: { role: Role.ADMIN, isActive: true, deletedAt: null } },
    });
    await this.deliver(subs, payload);
  }

  async sendToAllUsers(payload: PushNotificationPayload): Promise<void> {
    const subs = await this.prisma.pushSubscription.findMany({
      where: { user: { role: Role.USER, isActive: true, deletedAt: null } },
    });
    await this.deliver(subs, payload);
  }

  private async deliver(
    subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
    payload: PushNotificationPayload,
  ): Promise<void> {
    if (subs.length === 0) return;
    const json = JSON.stringify(payload);

    const results = await Promise.allSettled(
      subs.map((sub) =>
        sendWebPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, json, this.vapid),
      ),
    );

    // Prune dead subscriptions (404 / 410 Gone)
    const deadIds = subs
      .filter((_, i) => {
        const r = results[i];
        return r?.status === 'fulfilled' && r.value.expired;
      })
      .map((s) => s.id);

    if (deadIds.length > 0) {
      await this.prisma.pushSubscription.deleteMany({ where: { id: { in: deadIds } } });
      this.logger.log(`Pruned ${deadIds.length} expired push subscription(s)`);
    }

    for (const r of results) {
      if (r.status === 'rejected') this.logger.warn(`Push delivery failed: ${String(r.reason)}`);
    }
  }

  // ─── High-level notifications ────────────────────────────────────────────────

  /**
   * New newsletter post → in-app socket notification + web push for all trainees.
   * Called from the newsletter controller (REST), bridged to sockets via the gateway.
   */
  notifyNewsletterPost(post: { id: string; title: string | null; body: string | null }): void {
    const title = 'اطلاعیه جدید';
    const body = post.title?.trim() || post.body?.trim().slice(0, 90) || 'یک اطلاعیه جدید منتشر شد';

    // In-app (socket) — admins filter this type client-side
    const notif: SocketNotificationPayload = {
      type: 'newsletter',
      title,
      body,
      href: '/newsletter',
      postId: post.id,
      createdAt: new Date().toISOString(),
    };
    this.emitToRoom?.(SOCKET_ROOMS.newsletter(), SOCKET_EVENTS.NOTIFICATION_NEW, notif);

    // Web push (app closed/background) — fire and forget
    void this.sendToAllUsers({ title, body, url: '/newsletter', tag: `post-${post.id}` }).catch((err) =>
      this.logger.warn(`Newsletter push failed: ${String(err)}`),
    );
  }
}
