"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationsService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@karamooziyar/shared");
const prisma_service_1 = require("../../prisma/prisma.service");
let ConversationsService = class ConversationsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    // Admin: get all conversations sorted by latest message
    async findAllForAdmin() {
        const conversations = await this.prisma.conversation.findMany({
            include: {
                user: {
                    select: { id: true, firstName: true, lastName: true, avatarUrl: true, deletedAt: true },
                },
            },
            orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        });
        return conversations
            .filter((c) => !c.user.deletedAt)
            .map((c) => ({
            id: c.id,
            user: {
                id: c.user.id,
                firstName: c.user.firstName,
                lastName: c.user.lastName,
                avatarUrl: c.user.avatarUrl,
            },
            lastMessageText: c.lastMessageText,
            lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
            unreadByAdmin: c.unreadByAdmin,
            unreadByUser: c.unreadByUser,
        }));
    }
    // User: get their own conversation
    async findForUser(userId) {
        const conv = await this.getOrCreateConversation(userId);
        return {
            id: conv.id,
            userId: conv.userId,
            unreadByUser: conv.unreadByUser,
            unreadByAdmin: conv.unreadByAdmin,
            createdAt: conv.createdAt.toISOString(),
        };
    }
    // Admin: get single conversation summary by ID
    async findOneById(conversationId) {
        const conv = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
                user: {
                    select: { id: true, firstName: true, lastName: true, avatarUrl: true },
                },
            },
        });
        if (!conv)
            throw new common_1.NotFoundException('گفتگو یافت نشد');
        return {
            id: conv.id,
            user: {
                id: conv.user.id,
                firstName: conv.user.firstName,
                lastName: conv.user.lastName,
                avatarUrl: conv.user.avatarUrl,
            },
            lastMessageText: conv.lastMessageText,
            lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
            unreadByAdmin: conv.unreadByAdmin,
            unreadByUser: conv.unreadByUser,
        };
    }
    // Admin: find conversation by user ID (creates if not exists)
    async findByUserId(userId) {
        const conv = await this.prisma.conversation.upsert({
            where: { userId },
            create: { userId },
            update: {},
            include: {
                user: {
                    select: { id: true, firstName: true, lastName: true, avatarUrl: true },
                },
            },
        });
        return {
            id: conv.id,
            user: {
                id: conv.user.id,
                firstName: conv.user.firstName,
                lastName: conv.user.lastName,
                avatarUrl: conv.user.avatarUrl,
            },
            lastMessageText: conv.lastMessageText,
            lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
            unreadByAdmin: conv.unreadByAdmin,
            unreadByUser: conv.unreadByUser,
        };
    }
    // Get messages in a conversation with cursor pagination
    async getMessages(conversationId, requesterId, requesterRole, cursor, limit = 30) {
        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
        });
        if (!conversation)
            throw new common_1.NotFoundException('گفتگو یافت نشد');
        // Access control: user can only access their own conversation
        if (requesterRole === shared_1.Role.USER && conversation.userId !== requesterId) {
            throw new common_1.ForbiddenException('دسترسی غیرمجاز');
        }
        const messages = await this.prisma.message.findMany({
            where: {
                conversationId,
                deletedAt: null,
            },
            include: {
                sender: { select: { id: true, firstName: true, lastName: true } },
                attachment: true,
                seenBy: { select: { userId: true, seenAt: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const hasMore = messages.length > limit;
        const items = hasMore ? messages.slice(0, limit) : messages;
        const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
        // Mark messages as read
        await this.markMessagesAsRead(conversationId, requesterId, requesterRole);
        return {
            data: items.map((msg) => this.mapMessageToDto(msg)),
            nextCursor,
        };
    }
    async sendMessage(conversationId, senderId, senderRole, body, type, fileKey) {
        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
        });
        if (!conversation)
            throw new common_1.NotFoundException('گفتگو یافت نشد');
        if (senderRole === shared_1.Role.USER && conversation.userId !== senderId) {
            throw new common_1.ForbiddenException('دسترسی غیرمجاز');
        }
        const isFromUser = senderRole === shared_1.Role.USER;
        const message = await this.prisma.message.create({
            data: {
                conversationId,
                senderId,
                type: type,
                body: body ?? null,
                status: 'SENT',
            },
            include: {
                sender: { select: { id: true, firstName: true, lastName: true } },
                attachment: true,
                seenBy: true,
            },
        });
        // Update conversation metadata
        await this.prisma.conversation.update({
            where: { id: conversationId },
            data: {
                lastMessageAt: new Date(),
                lastMessageText: body ?? `[${type}]`,
                unreadByAdmin: isFromUser ? { increment: 1 } : undefined,
                unreadByUser: !isFromUser ? { increment: 1 } : undefined,
            },
        });
        return this.mapMessageToDto(message);
    }
    async editMessage(messageId, requesterId, body) {
        const message = await this.prisma.message.findUnique({
            where: { id: messageId, deletedAt: null },
            include: {
                sender: { select: { id: true, firstName: true, lastName: true } },
                attachment: true,
                seenBy: true,
            },
        });
        if (!message)
            throw new common_1.NotFoundException('پیام یافت نشد');
        if (message.senderId !== requesterId)
            throw new common_1.ForbiddenException('فقط فرستنده می‌تواند ویرایش کند');
        if (message.type !== 'TEXT')
            throw new common_1.ForbiddenException('فقط پیام متنی قابل ویرایش است');
        const updated = await this.prisma.message.update({
            where: { id: messageId },
            data: { body, isEdited: true, editedAt: new Date() },
            include: {
                sender: { select: { id: true, firstName: true, lastName: true } },
                attachment: true,
                seenBy: true,
            },
        });
        return this.mapMessageToDto(updated);
    }
    async deleteMessage(messageId, requesterId) {
        const message = await this.prisma.message.findUnique({
            where: { id: messageId, deletedAt: null },
        });
        if (!message)
            throw new common_1.NotFoundException('پیام یافت نشد');
        if (message.senderId !== requesterId)
            throw new common_1.ForbiddenException('فقط فرستنده می‌تواند حذف کند');
        await this.prisma.message.update({
            where: { id: messageId },
            data: { deletedAt: new Date(), deletedBy: requesterId },
        });
        return { messageId };
    }
    async markSeen(conversationId, messageId, userId) {
        await this.prisma.messageSeen.upsert({
            where: { messageId_userId: { messageId, userId } },
            create: { messageId, userId },
            update: {},
        });
        return { messageId, seenAt: new Date().toISOString() };
    }
    async markMessagesAsRead(conversationId, userId, role) {
        if (role === shared_1.Role.USER) {
            await this.prisma.conversation.update({
                where: { id: conversationId },
                data: { unreadByUser: 0 },
            });
        }
        else {
            await this.prisma.conversation.update({
                where: { id: conversationId },
                data: { unreadByAdmin: 0 },
            });
        }
    }
    async linkAttachmentToMessage(messageId, attachment) {
        await this.prisma.messageAttachment.create({
            data: { messageId, ...attachment },
        });
    }
    async getOrCreateConversation(userId) {
        return this.prisma.conversation.upsert({
            where: { userId },
            create: { userId },
            update: {},
        });
    }
    mapMessageToDto(msg) {
        return {
            id: msg.id,
            conversationId: msg.conversationId,
            senderId: msg.senderId,
            senderName: `${msg.sender.firstName} ${msg.sender.lastName}`,
            type: msg.type,
            body: msg.body,
            status: msg.status,
            isEdited: msg.isEdited,
            editedAt: msg.editedAt?.toISOString() ?? null,
            deletedAt: msg.deletedAt?.toISOString() ?? null,
            attachment: msg.attachment ? this.mapAttachment(msg.attachment) : null,
            createdAt: msg.createdAt.toISOString(),
        };
    }
    mapAttachment(att) {
        return {
            id: att.id,
            fileName: att.fileName,
            fileUrl: att.fileUrl,
            mimeType: att.mimeType,
            fileSize: att.fileSize,
            duration: att.duration,
        };
    }
};
exports.ConversationsService = ConversationsService;
exports.ConversationsService = ConversationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ConversationsService);
