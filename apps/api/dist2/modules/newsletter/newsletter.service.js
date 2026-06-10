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
exports.NewsletterService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const uploads_service_1 = require("../uploads/uploads.service");
let NewsletterService = class NewsletterService {
    prisma;
    uploadsService;
    constructor(prisma, uploadsService) {
        this.prisma = prisma;
        this.uploadsService = uploadsService;
    }
    async findAll(requesterId, cursor, limit = 20) {
        const posts = await this.prisma.newsletterPost.findMany({
            where: { deletedAt: null },
            include: {
                author: { select: { id: true, firstName: true, lastName: true } },
                attachments: true,
                reactions: { select: { emoji: true, userId: true } },
                seenBy: { select: { userId: true } },
            },
            orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const hasMore = posts.length > limit;
        const items = hasMore ? posts.slice(0, limit) : posts;
        const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
        return {
            data: items.map((p) => this.mapToDto(p, requesterId)),
            nextCursor,
        };
    }
    async create(authorId, input, attachmentFiles) {
        const post = await this.prisma.newsletterPost.create({
            data: {
                authorId,
                type: input.type ?? 'TEXT',
                body: input.body ?? null,
                isPinned: input.isPinned ?? false,
                attachments: attachmentFiles
                    ? {
                        create: attachmentFiles.map((f) => ({
                            fileName: f.fileName,
                            fileKey: f.fileKey,
                            fileUrl: f.fileUrl,
                            mimeType: f.mimeType,
                            fileSize: f.fileSize,
                            duration: f.duration,
                        })),
                    }
                    : undefined,
            },
            include: {
                author: { select: { id: true, firstName: true, lastName: true } },
                attachments: true,
                reactions: { select: { emoji: true, userId: true } },
                seenBy: { select: { userId: true } },
            },
        });
        return this.mapToDto(post, authorId);
    }
    async update(postId, requesterId, input) {
        const post = await this.findPostOrFail(postId);
        if (post.authorId !== requesterId) {
            throw new common_1.ForbiddenException('فقط نویسنده می‌تواند ویرایش کند');
        }
        const updated = await this.prisma.newsletterPost.update({
            where: { id: postId },
            data: {
                ...(input.body !== undefined ? { body: input.body, isEdited: true, editedAt: new Date() } : {}),
                ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
            },
            include: {
                author: { select: { id: true, firstName: true, lastName: true } },
                attachments: true,
                reactions: { select: { emoji: true, userId: true } },
                seenBy: { select: { userId: true } },
            },
        });
        return this.mapToDto(updated, requesterId);
    }
    async softDelete(postId, requesterId) {
        const post = await this.findPostOrFail(postId);
        if (post.authorId !== requesterId) {
            throw new common_1.ForbiddenException('دسترسی غیرمجاز');
        }
        // Delete S3 attachments
        const attachments = await this.prisma.newsletterAttachment.findMany({
            where: { postId },
        });
        await Promise.all(attachments.map((a) => this.uploadsService.deleteFile(a.fileKey)));
        await this.prisma.newsletterPost.update({
            where: { id: postId },
            data: { deletedAt: new Date() },
        });
        return { message: 'پست حذف شد' };
    }
    async markSeen(postId, userId) {
        await this.findPostOrFail(postId);
        await this.prisma.newsletterSeen.upsert({
            where: { postId_userId: { postId, userId } },
            create: { postId, userId },
            update: {},
        });
    }
    async react(postId, userId, emoji) {
        await this.findPostOrFail(postId);
        await this.prisma.newsletterReaction.upsert({
            where: { postId_userId: { postId, userId } },
            create: { postId, userId, emoji },
            update: { emoji },
        });
        return this.getReactionSummary(postId);
    }
    async removeReaction(postId, userId) {
        await this.prisma.newsletterReaction.deleteMany({ where: { postId, userId } });
        return this.getReactionSummary(postId);
    }
    async getSeenList(postId, page, limit) {
        await this.findPostOrFail(postId);
        const [seenList, total] = await Promise.all([
            this.prisma.newsletterSeen.findMany({
                where: { postId },
                include: { user: { select: { id: true, firstName: true, lastName: true } } },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { seenAt: 'desc' },
            }),
            this.prisma.newsletterSeen.count({ where: { postId } }),
        ]);
        return {
            data: seenList.map((s) => ({
                userId: s.userId,
                name: `${s.user.firstName} ${s.user.lastName}`,
                seenAt: s.seenAt.toISOString(),
            })),
            meta: { total, page, limit },
        };
    }
    async getReactionSummary(postId) {
        const reactions = await this.prisma.newsletterReaction.findMany({
            where: { postId },
            select: { emoji: true },
        });
        const summary = {};
        for (const r of reactions) {
            summary[r.emoji] = (summary[r.emoji] ?? 0) + 1;
        }
        return summary;
    }
    async findPostOrFail(postId) {
        const post = await this.prisma.newsletterPost.findUnique({
            where: { id: postId, deletedAt: null },
        });
        if (!post)
            throw new common_1.NotFoundException('پست یافت نشد');
        return post;
    }
    mapToDto(post, requesterId) {
        const reactionSummary = {};
        let myReaction = null;
        for (const r of post.reactions) {
            reactionSummary[r.emoji] = (reactionSummary[r.emoji] ?? 0) + 1;
            if (r.userId === requesterId)
                myReaction = r.emoji;
        }
        return {
            id: post.id,
            type: post.type,
            body: post.body,
            isPinned: post.isPinned,
            isEdited: post.isEdited,
            editedAt: post.editedAt?.toISOString() ?? null,
            author: post.author,
            attachments: post.attachments.map(this.mapAttachment),
            reactionSummary,
            myReaction,
            seenCount: post.seenBy.length,
            isSeen: post.seenBy.some((s) => s.userId === requesterId),
            createdAt: post.createdAt.toISOString(),
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
exports.NewsletterService = NewsletterService;
exports.NewsletterService = NewsletterService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        uploads_service_1.UploadsService])
], NewsletterService);
