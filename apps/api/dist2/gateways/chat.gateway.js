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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ChatGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const common_1 = require("@nestjs/common");
const socket_io_1 = require("socket.io");
const shared_1 = require("@karamooziyar/shared");
const ws_jwt_guard_1 = require("../modules/auth/guards/ws-jwt.guard");
const conversations_service_1 = require("../modules/conversations/conversations.service");
const newsletter_service_1 = require("../modules/newsletter/newsletter.service");
const uploads_service_1 = require("../modules/uploads/uploads.service");
let ChatGateway = ChatGateway_1 = class ChatGateway {
    conversationsService;
    newsletterService;
    uploadsService;
    server;
    logger = new common_1.Logger(ChatGateway_1.name);
    constructor(conversationsService, newsletterService, uploadsService) {
        this.conversationsService = conversationsService;
        this.newsletterService = newsletterService;
        this.uploadsService = uploadsService;
    }
    afterInit() {
        this.logger.log('WebSocket Gateway initialized');
    }
    async handleConnection(client) {
        try {
            if (!client.user) {
                client.disconnect();
                return;
            }
            const { sub: userId, role } = client.user;
            // Join user's personal room
            await client.join(shared_1.SOCKET_ROOMS.user(userId));
            // Admins join the admin room
            if (role === 'ADMIN') {
                await client.join(shared_1.SOCKET_ROOMS.admin());
            }
            // Join newsletter room for everyone
            await client.join(shared_1.SOCKET_ROOMS.newsletter());
            this.logger.log(`Client connected: ${userId} (${role})`);
        }
        catch {
            client.disconnect();
        }
    }
    handleDisconnect(client) {
        if (client.user) {
            this.logger.log(`Client disconnected: ${client.user.sub}`);
        }
    }
    // ─── Chat Events ─────────────────────────────────────────────────────────────
    async handleJoin(client, payload) {
        if (!client.user)
            return;
        await client.join(shared_1.SOCKET_ROOMS.conversation(payload.conversationId));
    }
    async handleLeave(client, payload) {
        await client.leave(shared_1.SOCKET_ROOMS.conversation(payload.conversationId));
    }
    async handleSendMessage(client, payload) {
        if (!client.user)
            return;
        const { sub: senderId, role } = client.user;
        try {
            // If file was uploaded, look up attachment info
            let attachmentData;
            if (payload.fileKey) {
                const presignedUrl = await this.uploadsService.getPresignedUrl(payload.fileKey);
                attachmentData = {
                    fileKey: payload.fileKey,
                    fileUrl: presignedUrl,
                    fileName: payload.fileKey.split('/').pop() ?? 'file',
                    mimeType: 'application/octet-stream',
                    fileSize: 0,
                    duration: null,
                };
            }
            const message = await this.conversationsService.sendMessage(payload.conversationId, senderId, role, payload.body, payload.type, payload.fileKey);
            if (attachmentData) {
                await this.conversationsService.linkAttachmentToMessage(message.id, attachmentData);
            }
            // Broadcast to conversation room
            const room = shared_1.SOCKET_ROOMS.conversation(payload.conversationId);
            this.server.to(room).emit(shared_1.SOCKET_EVENTS.CHAT_MESSAGE_NEW, {
                ...message,
                tempId: payload.tempId,
            });
            // Update admin's conversation list
            const conv = await this.conversationsService.findForUser(role === 'USER' ? senderId : payload.conversationId);
            this.server.to(shared_1.SOCKET_ROOMS.admin()).emit(shared_1.SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED, conv);
        }
        catch (err) {
            client.emit(shared_1.SOCKET_EVENTS.CHAT_ERROR, { message: err.message });
        }
    }
    handleTypingStart(client, payload) {
        if (!client.user)
            return;
        const room = shared_1.SOCKET_ROOMS.conversation(payload.conversationId);
        client.to(room).emit(shared_1.SOCKET_EVENTS.CHAT_TYPING, {
            conversationId: payload.conversationId,
            userId: client.user.sub,
            isTyping: true,
        });
    }
    handleTypingStop(client, payload) {
        if (!client.user)
            return;
        const room = shared_1.SOCKET_ROOMS.conversation(payload.conversationId);
        client.to(room).emit(shared_1.SOCKET_EVENTS.CHAT_TYPING, {
            conversationId: payload.conversationId,
            userId: client.user.sub,
            isTyping: false,
        });
    }
    async handleSeen(client, payload) {
        if (!client.user)
            return;
        const result = await this.conversationsService.markSeen(payload.conversationId, payload.messageId, client.user.sub);
        const room = shared_1.SOCKET_ROOMS.conversation(payload.conversationId);
        this.server.to(room).emit(shared_1.SOCKET_EVENTS.CHAT_MESSAGE_SEEN, {
            messageId: result.messageId,
            userId: client.user.sub,
            seenAt: result.seenAt,
        });
    }
    async handleEdit(client, payload) {
        if (!client.user)
            return;
        try {
            const updated = await this.conversationsService.editMessage(payload.messageId, client.user.sub, payload.body);
            const room = shared_1.SOCKET_ROOMS.conversation(updated.conversationId);
            this.server.to(room).emit(shared_1.SOCKET_EVENTS.CHAT_MESSAGE_UPDATED, {
                messageId: updated.id,
                body: updated.body,
                editedAt: updated.editedAt,
                conversationId: updated.conversationId,
            });
        }
        catch (err) {
            client.emit(shared_1.SOCKET_EVENTS.CHAT_ERROR, { message: err.message });
        }
    }
    async handleDelete(client, payload) {
        if (!client.user)
            return;
        try {
            const result = await this.conversationsService.deleteMessage(payload.messageId, client.user.sub);
            // We need conversationId — fetch it
            const room = shared_1.SOCKET_ROOMS.conversation(client.id); // fallback; ideally include conversationId in payload
            this.server.emit(shared_1.SOCKET_EVENTS.CHAT_MESSAGE_DELETED, result);
        }
        catch (err) {
            client.emit(shared_1.SOCKET_EVENTS.CHAT_ERROR, { message: err.message });
        }
    }
    // ─── Newsletter Events ────────────────────────────────────────────────────────
    async handleNewsletterJoin(client) {
        await client.join(shared_1.SOCKET_ROOMS.newsletter());
    }
    async handleNewsletterSeen(client, payload) {
        if (!client.user)
            return;
        await this.newsletterService.markSeen(payload.postId, client.user.sub);
        const seenCount = await this.getPostSeenCount(payload.postId);
        this.server
            .to(shared_1.SOCKET_ROOMS.admin())
            .emit(shared_1.SOCKET_EVENTS.NEWSLETTER_SEEN_UPDATED, { postId: payload.postId, seenCount });
    }
    async handleNewsletterReact(client, payload) {
        if (!client.user)
            return;
        const reactions = await this.newsletterService.react(payload.postId, client.user.sub, payload.emoji);
        this.server
            .to(shared_1.SOCKET_ROOMS.newsletter())
            .emit(shared_1.SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, { postId: payload.postId, reactions });
    }
    async handleNewsletterReactRemove(client, payload) {
        if (!client.user)
            return;
        const reactions = await this.newsletterService.removeReaction(payload.postId, client.user.sub);
        this.server
            .to(shared_1.SOCKET_ROOMS.newsletter())
            .emit(shared_1.SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, { postId: payload.postId, reactions });
    }
    // ─── Server-side helpers (called by services) ────────────────────────────────
    emitNewNewsletterPost(post) {
        this.server.to(shared_1.SOCKET_ROOMS.newsletter()).emit(shared_1.SOCKET_EVENTS.NEWSLETTER_POST_NEW, post);
    }
    emitUpdatedNewsletterPost(post) {
        this.server.to(shared_1.SOCKET_ROOMS.newsletter()).emit(shared_1.SOCKET_EVENTS.NEWSLETTER_POST_UPDATED, post);
    }
    emitDeletedNewsletterPost(postId) {
        this.server
            .to(shared_1.SOCKET_ROOMS.newsletter())
            .emit(shared_1.SOCKET_EVENTS.NEWSLETTER_POST_DELETED, { postId });
    }
    async getPostSeenCount(postId) {
        const { data: seenList } = await this.newsletterService.getSeenList(postId, 1, 1);
        // We don't need the actual data, just total
        const result = await this.newsletterService.getSeenList(postId, 1, 1);
        return result.meta.total;
    }
};
exports.ChatGateway = ChatGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], ChatGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.CHAT_JOIN),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleJoin", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.CHAT_LEAVE),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleLeave", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.CHAT_SEND),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleSendMessage", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.CHAT_TYPING_START),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ChatGateway.prototype, "handleTypingStart", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.CHAT_TYPING_STOP),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ChatGateway.prototype, "handleTypingStop", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.CHAT_SEEN),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleSeen", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.CHAT_EDIT),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleEdit", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.CHAT_DELETE),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleDelete", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.NEWSLETTER_JOIN),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleNewsletterJoin", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.NEWSLETTER_SEEN),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleNewsletterSeen", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.NEWSLETTER_REACT),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleNewsletterReact", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.NEWSLETTER_REACT_REMOVE),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleNewsletterReactRemove", null);
exports.ChatGateway = ChatGateway = ChatGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: {
            origin: (process.env['CORS_ORIGINS'] ?? 'http://localhost:3000').split(','),
            credentials: true,
        },
        transports: ['websocket', 'polling'],
        namespace: '/',
    }),
    (0, common_1.UseGuards)(ws_jwt_guard_1.WsJwtGuard),
    __metadata("design:paramtypes", [conversations_service_1.ConversationsService,
        newsletter_service_1.NewsletterService,
        uploads_service_1.UploadsService])
], ChatGateway);
