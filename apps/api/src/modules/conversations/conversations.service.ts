import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConversationSummaryDto,
  ConversationDetailDto,
  MessageDto,
  ReplyMessageDto,
  CursorPaginatedResponse,
  PaginatedResponse,
  AttachmentDto,
} from '@karamooziyar/shared';
import { Role, MessageType, MessageStatus } from '@karamooziyar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { isUniqueViolation } from '../../common/utils/prisma-error.util';
import type { Message, MessageAttachment } from '@prisma/client';

// ─── Prisma include helpers ────────────────────────────────────────────────────

const MESSAGE_INCLUDE = {
  sender: { select: { id: true, firstName: true, lastName: true } },
  attachment: true,
  seenBy: { select: { userId: true, seenAt: true } },
  replyToMessage: {
    include: {
      sender: { select: { id: true, firstName: true, lastName: true } },
      attachment: { select: { fileName: true, mimeType: true } },
    },
  },
} as const;

type MessageWithRelations = Message & {
  sender: { id: string; firstName: string; lastName: string };
  attachment: MessageAttachment | null;
  seenBy: Array<{ userId: string; seenAt: Date }>;
  replyToMessage: (Message & {
    sender: { id: string; firstName: string; lastName: string };
    attachment: { fileName: string; mimeType: string } | null;
  }) | null;
};

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Admin: list conversations ──────────────────────────────

  async findAllForAdmin(page: number, limit: number, search?: string): Promise<PaginatedResponse<ConversationSummaryDto>> {
    const where = {
      lastMessageAt: { not: null },
      user: {
        deletedAt: null,
        ...(search ? { OR: [
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
        ] } : {}),
      },
    };

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return {
      data: conversations.map(c => ({
        id: c.id,
        user: { id: c.user.id, firstName: c.user.firstName, lastName: c.user.lastName, avatarUrl: c.user.avatarUrl, profileImageUrl: null },
        lastMessageText: c.lastMessageText,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        unreadByAdmin: c.unreadByAdmin,
        unreadByUser: c.unreadByUser,
      })),
      meta: { total, page, limit },
    };
  }

  async findForUser(userId: string): Promise<ConversationDetailDto> {
    const conv = await this.getOrCreateConversation(userId);
    return { id: conv.id, userId: conv.userId, unreadByUser: conv.unreadByUser, unreadByAdmin: conv.unreadByAdmin, createdAt: conv.createdAt.toISOString() };
  }

  async findOneById(conversationId: string): Promise<ConversationSummaryDto> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    if (!conv) throw new NotFoundException('گفتگو یافت نشد');
    return {
      id: conv.id,
      user: { id: conv.user.id, firstName: conv.user.firstName, lastName: conv.user.lastName, avatarUrl: conv.user.avatarUrl, profileImageUrl: null },
      lastMessageText: conv.lastMessageText,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      unreadByAdmin: conv.unreadByAdmin,
      unreadByUser: conv.unreadByUser,
    };
  }

  async findByUserId(userId: string): Promise<ConversationSummaryDto> {
    const conv = await this.prisma.conversation.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    return {
      id: conv.id,
      user: { id: conv.user.id, firstName: conv.user.firstName, lastName: conv.user.lastName, avatarUrl: conv.user.avatarUrl, profileImageUrl: null },
      lastMessageText: conv.lastMessageText,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      unreadByAdmin: conv.unreadByAdmin,
      unreadByUser: conv.unreadByUser,
    };
  }

  // ─── Messages ─────────────────────────────────────────────

  async getMessages(
    conversationId: string,
    requesterId: string,
    requesterRole: string,
    cursor?: string,
    limit = 30,
  ): Promise<CursorPaginatedResponse<MessageDto>> {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('گفتگو یافت نشد');
    if (requesterRole === Role.USER && conversation.userId !== requesterId)
      throw new ForbiddenException('دسترسی غیرمجاز');

    const messages = await this.prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = messages.length > limit;
    const items = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    await this.markMessagesAsRead(conversationId, requesterId, requesterRole);

    return { data: items.map(msg => this.mapMessageToDto(msg as MessageWithRelations)), nextCursor };
  }

  /**
   * Durably persist a message (and its attachment, if any) and bump the
   * conversation's last-activity — all inside a single transaction so the
   * message, attachment, and conversation summary can never diverge.
   *
   * Idempotent: keyed by (senderId, clientMessageId). A duplicate request
   * (reconnect replay, manual retry, concurrent double-send) returns the
   * already-persisted message instead of creating a second row, and the
   * caller learns this via `deduped` so it can avoid re-broadcasting /
   * double-incrementing notifications.
   */
  async sendMessage(input: {
    conversationId: string;
    senderId: string;
    senderRole: string;
    clientMessageId: string;
    body?: string;
    type: string;
    replyToMessageId?: string;
    attachment?: {
      fileKey: string;
      fileUrl: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      duration: number | null;
    };
  }): Promise<{ message: MessageDto; deduped: boolean }> {
    const { conversationId, senderId, senderRole, clientMessageId, type } = input;
    let { body, replyToMessageId } = input;

    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('گفتگو یافت نشد');
    if (senderRole === Role.USER && conversation.userId !== senderId) throw new ForbiddenException('دسترسی غیرمجاز');

    // ── Idempotency fast-path: already persisted? return it untouched ──
    const existing = await this.findByClientMessageId(senderId, clientMessageId);
    if (existing) return { message: this.mapMessageToDto(existing), deduped: true };

    // Validate reply target belongs to same conversation
    if (replyToMessageId) {
      const replyTarget = await this.prisma.message.findUnique({ where: { id: replyToMessageId } });
      if (!replyTarget || replyTarget.conversationId !== conversationId) {
        replyToMessageId = undefined; // silently ignore invalid reply target
      }
    }

    const isFromUser = senderRole === Role.USER;

    try {
      const message = await this.prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            conversationId,
            senderId,
            // clientMessageId column exists after the idempotency migration;
            // cast keeps tsc happy until `prisma generate` is re-run (same
            // pattern used for pinnedAt elsewhere in this service).
            clientMessageId,
            type: type as 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE',
            body: body ?? null,
            status: 'SENT',
            ...(replyToMessageId ? { replyToMessageId } : {}),
            ...(input.attachment ? { attachment: { create: { ...input.attachment } } } : {}),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          include: MESSAGE_INCLUDE,
        });

        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: new Date(),
            lastMessageText: body ?? `[${type}]`,
            unreadByAdmin: isFromUser ? { increment: 1 } : undefined,
            unreadByUser: !isFromUser ? { increment: 1 } : undefined,
          },
        });

        return created;
      });

      return { message: this.mapMessageToDto(message as MessageWithRelations), deduped: false };
    } catch (err) {
      // Concurrent duplicate hit the partial unique index → return the winner.
      if (isUniqueViolation(err)) {
        const winner = await this.findByClientMessageId(senderId, clientMessageId);
        if (winner) return { message: this.mapMessageToDto(winner), deduped: true };
      }
      throw err;
    }
  }

  /**
   * Look up a message by its idempotency key. Returns null if not yet persisted.
   * Intentionally does NOT filter soft-deleted rows so the unique-violation
   * fallback always resolves to the winning row (the partial unique index
   * covers deleted rows too).
   */
  private async findByClientMessageId(
    senderId: string,
    clientMessageId: string,
  ): Promise<MessageWithRelations | null> {
    const found = await this.prisma.message.findFirst({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { senderId, clientMessageId } as any,
      include: MESSAGE_INCLUDE,
    });
    return (found as MessageWithRelations | null) ?? null;
  }

  async editMessage(messageId: string, requesterId: string, body: string): Promise<MessageDto> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId, deletedAt: null },
      include: MESSAGE_INCLUDE,
    });
    if (!message) throw new NotFoundException('پیام یافت نشد');
    if (message.senderId !== requesterId) throw new ForbiddenException('فقط فرستنده می‌تواند ویرایش کند');
    if (message.type !== 'TEXT') throw new ForbiddenException('فقط پیام متنی قابل ویرایش است');

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { body, isEdited: true, editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });

    return this.mapMessageToDto(updated as MessageWithRelations);
  }

  async deleteMessage(messageId: string, requesterId: string, requesterRole: string): Promise<{ messageId: string; conversationId: string }> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId, deletedAt: null } });
    if (!message) throw new NotFoundException('پیام یافت نشد');
    if (requesterRole !== Role.ADMIN && message.senderId !== requesterId)
      throw new ForbiddenException('فقط فرستنده می‌تواند حذف کند');

    await this.prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date(), deletedBy: requesterId } });
    return { messageId, conversationId: message.conversationId };
  }

  // ─── Pin / Unpin ──────────────────────────────────────────
  //
  // All pin operations use $executeRaw / $queryRaw so they work even before
  // `prisma generate` is re-run after adding the pinnedAt column.
  // Prisma's ORM layer validates field names against the generated client —
  // raw SQL bypasses that validation entirely.

  /**
   * Pin rules:
   *   ADMIN → can pin any message in the conversation, no limit on count.
   *   USER  → can only pin their own messages; the previous user-pin is
   *            cleared first so at most 1 pin is active per user.
   */
  async pinMessage(
    conversationId: string,
    messageId: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<MessageDto> {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('گفتگو یافت نشد');
    if (requesterRole === Role.USER && conversation.userId !== requesterId)
      throw new ForbiddenException('دسترسی غیرمجاز');

    const message = await this.prisma.message.findUnique({
      where: { id: messageId, deletedAt: null },
      include: MESSAGE_INCLUDE,
    });
    if (!message) throw new NotFoundException('پیام یافت نشد');
    if (message.conversationId !== conversationId) throw new ForbiddenException('پیام در این گفتگو نیست');

    if (requesterRole === Role.USER && message.senderId !== requesterId)
      throw new ForbiddenException('کاربر تنها می‌تواند پیام‌های خود را پین کند');

    // USER: clear any existing pin in this conversation first
    if (requesterRole === Role.USER) {
      await this.prisma.$executeRaw`
        UPDATE messages
        SET "pinnedAt" = NULL, "pinnedBy" = NULL
        WHERE "conversationId" = ${conversationId}
          AND "deletedAt" IS NULL
          AND "pinnedAt" IS NOT NULL
      `;
    }

    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE messages
      SET "pinnedAt" = ${now}, "pinnedBy" = ${requesterId}
      WHERE id = ${messageId}
    `;

    return this.mapMessageToDto(message as MessageWithRelations, now);
  }

  async unpinMessage(
    conversationId: string,
    messageId: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<{ messageId: string; conversationId: string }> {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('گفتگو یافت نشد');
    if (requesterRole === Role.USER && conversation.userId !== requesterId)
      throw new ForbiddenException('دسترسی غیرمجاز');

    const message = await this.prisma.message.findUnique({ where: { id: messageId, deletedAt: null } });
    if (!message) throw new NotFoundException('پیام یافت نشد');
    if (message.conversationId !== conversationId) throw new ForbiddenException('پیام در این گفتگو نیست');

    // Check pinnedBy via raw SQL so we don't need the regenerated client
    const rows = await this.prisma.$queryRaw<{ pinnedBy: string | null }[]>`
      SELECT "pinnedBy" FROM messages WHERE id = ${messageId} LIMIT 1
    `;
    const pinnedBy = rows[0]?.pinnedBy ?? null;

    if (requesterRole === Role.USER && pinnedBy !== requesterId)
      throw new ForbiddenException('دسترسی غیرمجاز');

    await this.prisma.$executeRaw`
      UPDATE messages SET "pinnedAt" = NULL, "pinnedBy" = NULL WHERE id = ${messageId}
    `;

    return { messageId, conversationId };
  }

  /** Return all pinned messages for a conversation, sorted by pinnedAt desc */
  async getPinnedMessages(
    conversationId: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<MessageDto[]> {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('گفتگو یافت نشد');
    if (requesterRole === Role.USER && conversation.userId !== requesterId)
      throw new ForbiddenException('دسترسی غیرمجاز');

    // Use raw SQL to find pinned message IDs — avoids Prisma ORM validation
    // for the new pinnedAt column (works before `prisma generate` is re-run)
    let rows: { id: string; pinnedAt: Date }[] = [];
    try {
      rows = await this.prisma.$queryRaw<{ id: string; pinnedAt: Date }[]>`
        SELECT id, "pinnedAt"
        FROM messages
        WHERE "conversationId" = ${conversationId}
          AND "deletedAt" IS NULL
          AND "pinnedAt" IS NOT NULL
        ORDER BY "pinnedAt" DESC
      `;
    } catch {
      // Column doesn't exist yet (migration pending) — return empty
      return [];
    }

    if (rows.length === 0) return [];

    // Fetch full message data for pinned IDs using normal Prisma + include
    const ids = rows.map((r) => r.id);
    const pinnedAtMap = new Map(rows.map((r) => [r.id, r.pinnedAt]));

    const messages = await this.prisma.message.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: MESSAGE_INCLUDE,
    });

    // Re-sort to match raw SQL order and inject pinnedAt
    const sorted = ids
      .map((id) => messages.find((m) => m.id === id))
      .filter(Boolean) as MessageWithRelations[];

    return sorted.map((m) =>
      this.mapMessageToDto(m, pinnedAtMap.get(m.id) ?? null),
    );
  }

  async markSeen(conversationId: string, messageId: string, userId: string): Promise<{ messageId: string; seenAt: string }> {
    // ── INVARIANT: seen bookkeeping is NON-CRITICAL. ──────────────────────────
    // Root-cause of the production `message_seen_messageId_fkey` (P2003):
    //   • The client can emit `chat:seen` with a clientMessageId (optimistic temp
    //     id, e.g. "cm_abc") before the server has persisted the message.
    //   • That id does NOT exist in `messages.id`; only in `messages.clientMessageId`.
    //   • Calling messageSeen.upsert({ messageId: "cm_abc" }) → FK violation.
    //
    // Fix (two-layer defence):
    //   1. Guard: only proceed if `messageId` matches a real persisted `messages.id`
    //      in this conversation.  The FK constraint is on `messages.id`, so we
    //      MUST use `id:` not `clientMessageId:` here.  We do NOT filter by
    //      deletedAt because a soft-deleted row still satisfies the FK; we record
    //      the seen only for visible messages (deletedAt: null) as a UX choice.
    //   2. Catch: if a rare TOCTOU hard-delete or concurrent race causes P2003
    //      despite the guard, log it (never rethrow — seen is best-effort).
    //
    // This function MUST always return a value (never throw) so callers can ack
    // a persisted message as ok regardless of seen bookkeeping outcome.
    const seenAt = new Date().toISOString();

    // Guard 1: `messageId` must exist as a real server row in this conversation.
    // This is the only value that satisfies the FK on `message_seen.messageId`.
    const exists = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      // `messageId` is either an optimistic clientMessageId, belongs to a
      // different conversation, or is a soft-deleted message — skip silently.
      return { messageId, seenAt };
    }

    try {
      await this.prisma.messageSeen.upsert({
        where: { messageId_userId: { messageId: exists.id, userId } },
        create: { messageId: exists.id, userId },
        update: {},
      });
    } catch (err) {
      // P2002: already seen (unique conflict) — harmless, swallow.
      // P2003: FK violation despite guard (race with hard-delete) — log, swallow.
      // Any other DB error — also log and swallow; seen is best-effort.
      this.logger.warn(
        `markSeen ignored non-critical error (conv=${conversationId} msg=${messageId}): ${(err as Error).message}`,
      );
    }

    return { messageId, seenAt };
  }

  async markMessagesAsRead(conversationId: string, userId: string, role: string): Promise<void> {
    if (role === Role.USER) {
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { unreadByUser: 0 } });
    } else {
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { unreadByAdmin: 0 } });
    }
  }

  async linkAttachmentToMessage(messageId: string, attachment: { fileKey: string; fileUrl: string; fileName: string; mimeType: string; fileSize: number; duration: number | null }): Promise<AttachmentDto> {
    const created = await this.prisma.messageAttachment.create({ data: { messageId, ...attachment } });
    return { id: created.id, fileName: created.fileName, fileUrl: created.fileUrl, mimeType: created.mimeType, fileSize: created.fileSize, duration: created.duration };
  }

  private async getOrCreateConversation(userId: string) {
    return this.prisma.conversation.upsert({ where: { userId }, create: { userId }, update: {} });
  }

  /**
   * @param pinnedAt — pass explicitly when you have it from a raw SQL query,
   *   since the Prisma-generated client doesn't know about this field until
   *   `prisma generate` is re-run after the pin migration.
   */
  private mapMessageToDto(msg: MessageWithRelations, pinnedAt?: Date | null): MessageDto {
    // Fall back to any runtime value on the object (works after prisma generate)
    const resolvedPinnedAt = pinnedAt !== undefined
      ? pinnedAt
      : ((msg as any).pinnedAt as Date | null | undefined) ?? null;

    return {
      id: msg.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientMessageId: ((msg as any).clientMessageId as string | null | undefined) ?? null,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      senderName: `${msg.sender.firstName} ${msg.sender.lastName}`,
      type: msg.type as MessageType,
      body: msg.body,
      status: msg.status as MessageStatus,
      isEdited: msg.isEdited,
      editedAt: msg.editedAt?.toISOString() ?? null,
      deletedAt: msg.deletedAt?.toISOString() ?? null,
      pinnedAt: resolvedPinnedAt ? new Date(resolvedPinnedAt).toISOString() : null,
      attachment: msg.attachment ? this.mapAttachment(msg.attachment) : null,
      replyToMessage: msg.replyToMessage ? this.mapReply(msg.replyToMessage) : null,
      createdAt: msg.createdAt.toISOString(),
    };
  }

  private mapReply(msg: Message & {
    sender: { id: string; firstName: string; lastName: string };
    attachment: { fileName: string; mimeType: string } | null;
  }): ReplyMessageDto {
    return {
      id: msg.id,
      senderId: msg.senderId,
      senderName: `${msg.sender.firstName} ${msg.sender.lastName}`,
      type: msg.type as MessageType,
      body: msg.body,
      deletedAt: msg.deletedAt?.toISOString() ?? null,
      attachment: msg.attachment ? { fileName: msg.attachment.fileName, mimeType: msg.attachment.mimeType } : null,
    };
  }

  private mapAttachment(att: MessageAttachment): AttachmentDto {
    return { id: att.id, fileName: att.fileName, fileUrl: att.fileUrl, mimeType: att.mimeType, fileSize: att.fileSize, duration: att.duration };
  }
}
