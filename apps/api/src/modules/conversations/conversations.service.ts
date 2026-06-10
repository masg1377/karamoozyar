import {
  ForbiddenException,
  Injectable,
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

  async sendMessage(
    conversationId: string,
    senderId: string,
    senderRole: string,
    body: string | undefined,
    type: string,
    fileKey?: string,
    replyToMessageId?: string,
  ): Promise<MessageDto> {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('گفتگو یافت نشد');
    if (senderRole === Role.USER && conversation.userId !== senderId) throw new ForbiddenException('دسترسی غیرمجاز');

    // Validate reply target belongs to same conversation
    if (replyToMessageId) {
      const replyTarget = await this.prisma.message.findUnique({ where: { id: replyToMessageId } });
      if (!replyTarget || replyTarget.conversationId !== conversationId) {
        // Silently ignore invalid reply target
        replyToMessageId = undefined;
      }
    }

    const isFromUser = senderRole === Role.USER;

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        type: type as 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE',
        body: body ?? null,
        status: 'SENT',
        ...(replyToMessageId ? { replyToMessageId } : {}),
      },
      include: MESSAGE_INCLUDE,
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessageText: body ?? `[${type}]`,
        unreadByAdmin: isFromUser ? { increment: 1 } : undefined,
        unreadByUser: !isFromUser ? { increment: 1 } : undefined,
      },
    });

    return this.mapMessageToDto(message as MessageWithRelations);
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
    try {
      await this.prisma.messageSeen.upsert({
        where: { messageId_userId: { messageId, userId } },
        create: { messageId, userId },
        update: {},
      });
    } catch {
      // P2002: unique constraint — already seen, which is fine
    }
    return { messageId, seenAt: new Date().toISOString() };
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
