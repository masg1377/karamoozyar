import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import type { JwtPayload } from '@karamooziyar/shared';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import {
  SOCKET_EVENTS,
  SOCKET_ROOMS,
  type SocketChatSendPayload,
  type SocketTypingPayload,
  type SocketSeenPayload,
  type SocketEditPayload,
  type SocketDeletePayload,
  type SocketNewsletterReactPayload,
  type SocketNewsletterSeenPayload,
  type SocketNotificationPayload,
  ReactionEmoji,
} from '@karamooziyar/shared';
import { WsJwtGuard } from '../modules/auth/guards/ws-jwt.guard';
import { PushService } from '../modules/push/push.service';
import { ConversationsService } from '../modules/conversations/conversations.service';
import { NewsletterService } from '../modules/newsletter/newsletter.service';
import { UploadsService } from '../modules/uploads/uploads.service';

type AuthSocket = Socket & { user?: JwtPayload };

@WebSocketGateway({
  cors: {
    origin: (process.env['CORS_ORIGINS'] ?? 'http://localhost:3000').split(','),
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  namespace: '/',
})
@UseGuards(WsJwtGuard)
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly newsletterService: NewsletterService,
    private readonly uploadsService: UploadsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
  ) {}

  afterInit(): void {
    // Bridge: lets non-gateway modules (e.g. newsletter REST) emit socket events
    this.pushService.registerSocketEmitter((room, event, payload) => {
      this.server.to(room).emit(event, payload);
    });
    this.logger.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: AuthSocket): Promise<void> {
    try {
      // @UseGuards does NOT run on lifecycle hooks — authenticate manually here
      const token = this.extractToken(client);
      if (!token) {
        client.disconnect();
        return;
      }

      const jwtSecret = this.configService.get('jwt', { infer: true }).accessSecret;
      let payload: JwtPayload;
      try {
        payload = this.jwtService.verify<JwtPayload>(token, { secret: jwtSecret });
      } catch {
        client.disconnect();
        return;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub, isActive: true, deletedAt: null },
        select: { id: true, role: true, nationalId: true },
      });

      if (!user) {
        client.disconnect();
        return;
      }

      client.user = { sub: user.id, nationalId: user.nationalId, role: user.role as JwtPayload['role'] };

      const { sub: userId, role } = client.user;

      // Join user's personal room
      await client.join(SOCKET_ROOMS.user(userId));

      // Admins join the admin room
      if (role === 'ADMIN') {
        await client.join(SOCKET_ROOMS.admin());
      }

      // Join newsletter room for everyone
      await client.join(SOCKET_ROOMS.newsletter());

      this.logger.log(`Client connected: ${userId} (${role})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthSocket): void {
    if (client.user) {
      this.logger.log(`Client disconnected: ${client.user.sub}`);
    }
  }

  // ─── Chat Events ─────────────────────────────────────────────────────────────

  @SubscribeMessage(SOCKET_EVENTS.CHAT_JOIN)
  async handleJoin(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: { conversationId: string },
  ): Promise<void> {
    if (!client.user) return;
    await client.join(SOCKET_ROOMS.conversation(payload.conversationId));
  }

  @SubscribeMessage(SOCKET_EVENTS.CHAT_LEAVE)
  async handleLeave(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: { conversationId: string },
  ): Promise<void> {
    await client.leave(SOCKET_ROOMS.conversation(payload.conversationId));
  }

  @SubscribeMessage(SOCKET_EVENTS.CHAT_SEND)
  async handleSendMessage(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: SocketChatSendPayload,
  ): Promise<import('@karamooziyar/shared').SocketChatSendAck> {
    const clientMessageId = payload.clientMessageId ?? payload.tempId ?? '';
    if (!client.user) {
      return { ok: false, clientMessageId, code: 'FORBIDDEN', error: 'unauthenticated' };
    }
    const { sub: senderId, role } = client.user;

    // Structured correlation log — no message body (privacy).
    this.logger.log(
      `chat:send conv=${payload.conversationId} sender=${senderId} type=${payload.type} cid=${clientMessageId}`,
    );

    if (!clientMessageId || clientMessageId.length < 8) {
      return { ok: false, clientMessageId, code: 'VALIDATION', error: 'missing clientMessageId' };
    }

    try {
      // Build the durable attachment (stable, non-expiring URL) up front so the
      // message + attachment are persisted atomically inside sendMessage.
      const attachment = payload.fileKey
        ? {
            fileKey: payload.fileKey,
            fileUrl: this.uploadsService.buildPublicUrl(payload.fileKey, payload.fileName),
            fileName: payload.fileName ?? payload.fileKey.split('/').pop() ?? 'file',
            mimeType: payload.mimeType ?? 'application/octet-stream',
            fileSize: payload.fileSize ?? 0,
            // Trust client duration only for audio/video; clamp via validator upstream.
            duration:
              payload.type === 'VOICE' && typeof payload.duration === 'number'
                ? payload.duration
                : null,
          }
        : undefined;

      const { message, deduped } = await this.conversationsService.sendMessage({
        conversationId: payload.conversationId,
        senderId,
        senderRole: role,
        clientMessageId,
        body: payload.body,
        type: payload.type,
        replyToMessageId: payload.replyToMessageId,
        attachment,
      });

      // A duplicate (retry / reconnect replay) is already broadcast and counted.
      // Just ack the sender so its optimistic item reconciles — no second
      // broadcast, no double unread/notification.
      if (deduped) {
        return { ok: true, clientMessageId, message };
      }

      // Broadcast to the room EXCLUDING the sender — the sender reconciles via
      // this ack, so it never receives a duplicate echo of its own message.
      const room = SOCKET_ROOMS.conversation(payload.conversationId);
      client.to(room).emit(SOCKET_EVENTS.CHAT_MESSAGE_NEW, message);

      // Update admin's conversation list
      const conv = role === 'USER'
        ? await this.conversationsService.findForUser(senderId)
        : await this.conversationsService.findOneById(payload.conversationId);
      this.server.to(SOCKET_ROOMS.admin()).emit(SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED, conv);

      // ── Notify the receiving side (in-app + web push) ──────────────────────
      const preview = this.messagePreview(payload.type, payload.body);
      const createdAt = message.createdAt;

      if (role === 'USER') {
        const href = `/admin/conversations/${payload.conversationId}`;
        this.server.to(SOCKET_ROOMS.admin()).emit(SOCKET_EVENTS.NOTIFICATION_NEW, {
          type: 'message',
          title: message.senderName,
          body: preview,
          href,
          conversationId: payload.conversationId,
          createdAt,
        } satisfies SocketNotificationPayload);
        void this.pushService
          .sendToAdmins({ title: message.senderName, body: preview, url: href, tag: `conv-${payload.conversationId}` })
          .catch((err) => this.logger.warn(`Push to admins failed: ${String(err)}`));
      } else {
        const recipientId = 'user' in conv ? conv.user.id : conv.userId;
        const userRoom = SOCKET_ROOMS.user(recipientId);
        this.server.to(userRoom).emit(SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED, conv);
        this.server.to(userRoom).emit(SOCKET_EVENTS.NOTIFICATION_NEW, {
          type: 'message',
          title: 'مدیریت مرکز',
          body: preview,
          href: '/chat',
          conversationId: payload.conversationId,
          createdAt,
        } satisfies SocketNotificationPayload);
        void this.pushService
          .sendToUser(recipientId, { title: 'مدیریت مرکز', body: preview, url: '/chat', tag: `conv-${payload.conversationId}` })
          .catch((err) => this.logger.warn(`Push to user failed: ${String(err)}`));
      }

      // Durable success ack — only returned AFTER the transaction committed.
      return { ok: true, clientMessageId, message };
    } catch (err) {
      // Surface a typed, non-fatal failure to the sender (kept visible + retryable);
      // do NOT emit CHAT_ERROR for sends — that path is for global UI errors.
      this.logger.warn(`chat:send failed cid=${clientMessageId}: ${(err as Error).message}`);
      const code = this.classifySendError(err);
      return { ok: false, clientMessageId, code, error: this.safeErrorMessage(code) };
    }
  }

  /** Map an internal error to a typed, client-safe send error code. */
  private classifySendError(err: unknown): import('@karamooziyar/shared').SocketChatSendErrorCode {
    const name = (err as { constructor?: { name?: string } })?.constructor?.name ?? '';
    if (name === 'ForbiddenException') return 'FORBIDDEN';
    if (name === 'NotFoundException') return 'NOT_FOUND';
    if (name === 'BadRequestException') return 'VALIDATION';
    return 'INTERNAL';
  }

  /** User-safe Persian message per code — never leaks internals/stack/keys. */
  private safeErrorMessage(code: import('@karamooziyar/shared').SocketChatSendErrorCode): string {
    switch (code) {
      case 'FORBIDDEN': return 'دسترسی غیرمجاز';
      case 'NOT_FOUND': return 'گفتگو یافت نشد';
      case 'VALIDATION': return 'داده نامعتبر است';
      case 'ATTACHMENT': return 'بارگذاری فایل ناموفق بود';
      default: return 'ارسال پیام ناموفق بود';
    }
  }

  @SubscribeMessage(SOCKET_EVENTS.CHAT_TYPING_START)
  handleTypingStart(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: SocketTypingPayload,
  ): void {
    if (!client.user) return;
    const room = SOCKET_ROOMS.conversation(payload.conversationId);
    client.to(room).emit(SOCKET_EVENTS.CHAT_TYPING, {
      conversationId: payload.conversationId,
      userId: client.user.sub,
      isTyping: true,
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.CHAT_TYPING_STOP)
  handleTypingStop(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: SocketTypingPayload,
  ): void {
    if (!client.user) return;
    const room = SOCKET_ROOMS.conversation(payload.conversationId);
    client.to(room).emit(SOCKET_EVENTS.CHAT_TYPING, {
      conversationId: payload.conversationId,
      userId: client.user.sub,
      isTyping: false,
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.CHAT_SEEN)
  async handleSeen(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: SocketSeenPayload,
  ): Promise<void> {
    if (!client.user) return;

    const result = await this.conversationsService.markSeen(
      payload.conversationId,
      payload.messageId,
      client.user.sub,
    );

    // Update lastSeenAt for inactivity tracking (fire-and-forget)
    this.prisma.user.update({
      where: { id: client.user.sub },
      data: { lastSeenAt: new Date() } as any,
    }).catch(() => {/* non-critical */});

    const room = SOCKET_ROOMS.conversation(payload.conversationId);
    this.server.to(room).emit(SOCKET_EVENTS.CHAT_MESSAGE_SEEN, {
      messageId: result.messageId,
      userId: client.user.sub,
      seenAt: result.seenAt,
    });

    // همگام‌سازی badge خوانده‌نشده در کل اپ — شمارنده‌ی سمتِ خواننده را صفر کن و خبر بده
    try {
      await this.conversationsService.markMessagesAsRead(
        payload.conversationId,
        client.user.sub,
        client.user.role,
      );
      const conv = await this.conversationsService.findOneById(payload.conversationId);
      if (client.user.role === 'ADMIN') {
        this.server.to(SOCKET_ROOMS.admin()).emit(SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED, conv);
      } else {
        this.server
          .to(SOCKET_ROOMS.user(client.user.sub))
          .emit(SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED, conv);
      }
    } catch { /* non-critical */ }
  }

  @SubscribeMessage(SOCKET_EVENTS.CHAT_EDIT)
  async handleEdit(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: SocketEditPayload,
  ): Promise<void> {
    if (!client.user) return;

    try {
      const updated = await this.conversationsService.editMessage(
        payload.messageId,
        client.user.sub,
        payload.body,
      );

      const room = SOCKET_ROOMS.conversation(updated.conversationId);
      this.server.to(room).emit(SOCKET_EVENTS.CHAT_MESSAGE_UPDATED, {
        messageId: updated.id,
        body: updated.body,
        editedAt: updated.editedAt,
        conversationId: updated.conversationId,
      });
    } catch (err) {
      client.emit(SOCKET_EVENTS.CHAT_ERROR, { message: (err as Error).message });
    }
  }

  @SubscribeMessage(SOCKET_EVENTS.CHAT_DELETE)
  async handleDelete(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: SocketDeletePayload,
  ): Promise<void> {
    if (!client.user) return;

    try {
      const result = await this.conversationsService.deleteMessage(
        payload.messageId,
        client.user.sub,
        client.user.role,
      );

      // Broadcast only to the conversation room (not the entire server)
      const room = SOCKET_ROOMS.conversation(payload.conversationId);
      this.server.to(room).emit(SOCKET_EVENTS.CHAT_MESSAGE_DELETED, result);
    } catch (err) {
      client.emit(SOCKET_EVENTS.CHAT_ERROR, { message: (err as Error).message });
    }
  }

  // ─── Pin Events ───────────────────────────────────────────────────────────────

  @SubscribeMessage(SOCKET_EVENTS.CHAT_MESSAGE_PINNED)
  async handlePin(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: { conversationId: string; messageId: string; action: 'pin' | 'unpin' },
  ): Promise<void> {
    if (!client.user) return;

    try {
      const room = SOCKET_ROOMS.conversation(payload.conversationId);
      if (payload.action === 'pin') {
        const msg = await this.conversationsService.pinMessage(
          payload.conversationId,
          payload.messageId,
          client.user.sub,
          client.user.role,
        );
        this.server.to(room).emit(SOCKET_EVENTS.CHAT_MESSAGE_PINNED, { action: 'pin', message: msg });
      } else {
        const result = await this.conversationsService.unpinMessage(
          payload.conversationId,
          payload.messageId,
          client.user.sub,
          client.user.role,
        );
        this.server.to(room).emit(SOCKET_EVENTS.CHAT_MESSAGE_PINNED, { action: 'unpin', ...result });
      }
    } catch (err) {
      client.emit(SOCKET_EVENTS.CHAT_ERROR, { message: (err as Error).message });
    }
  }

  // ─── Newsletter Events ────────────────────────────────────────────────────────

  @SubscribeMessage(SOCKET_EVENTS.NEWSLETTER_JOIN)
  async handleNewsletterJoin(@ConnectedSocket() client: AuthSocket): Promise<void> {
    await client.join(SOCKET_ROOMS.newsletter());
  }

  @SubscribeMessage(SOCKET_EVENTS.NEWSLETTER_SEEN)
  async handleNewsletterSeen(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: SocketNewsletterSeenPayload,
  ): Promise<void> {
    if (!client.user) return;
    await this.newsletterService.markSeen(payload.postId, client.user.sub);

    const seenCount = await this.getPostSeenCount(payload.postId);
    this.server
      .to(SOCKET_ROOMS.admin())
      .emit(SOCKET_EVENTS.NEWSLETTER_SEEN_UPDATED, { postId: payload.postId, seenCount });
  }

  @SubscribeMessage(SOCKET_EVENTS.NEWSLETTER_REACT)
  async handleNewsletterReact(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: SocketNewsletterReactPayload,
  ): Promise<void> {
    if (!client.user) return;
    const reactions = await this.newsletterService.react(
      payload.postId,
      client.user.sub,
      payload.emoji as ReactionEmoji,
    );

    this.server
      .to(SOCKET_ROOMS.newsletter())
      .emit(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, { postId: payload.postId, reactions });
  }

  @SubscribeMessage(SOCKET_EVENTS.NEWSLETTER_REACT_REMOVE)
  async handleNewsletterReactRemove(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() payload: { postId: string },
  ): Promise<void> {
    if (!client.user) return;
    const reactions = await this.newsletterService.removeReaction(payload.postId, client.user.sub);

    this.server
      .to(SOCKET_ROOMS.newsletter())
      .emit(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, { postId: payload.postId, reactions });
  }

  // ─── Server-side helpers (called by services) ────────────────────────────────

  emitNewNewsletterPost(post: unknown): void {
    this.server.to(SOCKET_ROOMS.newsletter()).emit(SOCKET_EVENTS.NEWSLETTER_POST_NEW, post);
  }

  emitUpdatedNewsletterPost(post: unknown): void {
    this.server.to(SOCKET_ROOMS.newsletter()).emit(SOCKET_EVENTS.NEWSLETTER_POST_UPDATED, post);
  }

  emitDeletedNewsletterPost(postId: string): void {
    this.server
      .to(SOCKET_ROOMS.newsletter())
      .emit(SOCKET_EVENTS.NEWSLETTER_POST_DELETED, { postId });
  }

  /** پیش‌نمایش کوتاه پیام برای اعلان‌ها */
  private messagePreview(type: string, body?: string): string {
    switch (type) {
      case 'IMAGE':
        return '📷 تصویر';
      case 'VOICE':
        return '🎤 پیام صوتی';
      case 'FILE':
        return '📎 فایل';
      default: {
        const text = body?.trim() ?? '';
        return text.length > 90 ? `${text.slice(0, 90)}…` : text || 'پیام جدید';
      }
    }
  }

  private extractToken(client: Socket): string | null {
    const authHeader = client.handshake.auth['token'] as string | undefined;
    if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);
    return authHeader ?? null;
  }

  private async getPostSeenCount(postId: string): Promise<number> {
    const { data: seenList } = await this.newsletterService.getSeenList(postId, 1, 1);
    // We don't need the actual data, just total
    const result = await this.newsletterService.getSeenList(postId, 1, 1);
    return result.meta.total;
  }
}
