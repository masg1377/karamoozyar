import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  NewsletterPostDto,
  NewsletterAttachmentDto,
  CursorPaginatedResponse,
  PaginatedResponse,
  ReactionSummaryDto,
  NewsletterBlock,
} from '@karamooziyar/shared';
import { ReactionEmoji } from '@karamooziyar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { NewsletterAttachment, NewsletterPost } from '@prisma/client';
import { UploadsService } from '../uploads/uploads.service';

type PostWithRelations = Omit<NewsletterPost, 'contentBlocks' | 'hashtags'> & {
  // New fields added by migration (not yet in generated Prisma types — run prisma generate after migration)
  title?: string | null;
  contentBlocks?: unknown;
  hashtags?: string[];
  author: { id: string; firstName: string; lastName: string };
  attachments: NewsletterAttachment[];
  reactions: Array<{ emoji: string; userId: string }>;
  seenBy: Array<{ userId: string }>;
};

interface BlockUpload {
  fileKey: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  duration?: number | null;
}

interface PostInput {
  title?: string;
  body?: string;
  contentBlocks?: NewsletterBlock[];
  hashtags?: string[];
  isPinned?: boolean;
  uploads?: Record<string, BlockUpload>;
}

@Injectable()
export class NewsletterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadsService: UploadsService,
  ) {}

  async findAll(
    requesterId: string,
    cursor?: string,
    limit = 20,
  ): Promise<CursorPaginatedResponse<NewsletterPostDto>> {
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

  async findOne(postId: string, requesterId: string): Promise<NewsletterPostDto> {
    const post = await this.prisma.newsletterPost.findUnique({
      where: { id: postId, deletedAt: null },
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
        attachments: true,
        reactions: { select: { emoji: true, userId: true } },
        seenBy: { select: { userId: true } },
      },
    });
    if (!post) throw new NotFoundException('پست یافت نشد');
    return this.mapToDto(post as PostWithRelations, requesterId);
  }

  async create(authorId: string, input: PostInput): Promise<NewsletterPostDto> {
    const resolvedBlocks = await this.resolveBlocks(input.contentBlocks, input.uploads);

    const post = await this.prisma.newsletterPost.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        authorId,
        title: input.title ?? null,
        body: input.body ?? null,
        contentBlocks: resolvedBlocks.length > 0 ? (resolvedBlocks as unknown as object[]) : undefined,
        hashtags: input.hashtags ?? [],
        isPinned: input.isPinned ?? false,
      } as any,
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
        attachments: true,
        reactions: { select: { emoji: true, userId: true } },
        seenBy: { select: { userId: true } },
      },
    });

    await this.linkAttachments(post.id, resolvedBlocks);

    const refreshed = await this.prisma.newsletterPost.findUniqueOrThrow({
      where: { id: post.id },
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
        attachments: true,
        reactions: { select: { emoji: true, userId: true } },
        seenBy: { select: { userId: true } },
      },
    });

    return this.mapToDto(refreshed, authorId);
  }

  async update(postId: string, requesterId: string, input: PostInput): Promise<NewsletterPostDto> {
    await this.findPostOrFail(postId);

    const resolvedBlocks = await this.resolveBlocks(input.contentBlocks, input.uploads);

    const updated = await this.prisma.newsletterPost.update({
      where: { id: postId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.body !== undefined && { body: input.body, isEdited: true, editedAt: new Date() }),
        ...(resolvedBlocks.length > 0 && {
          contentBlocks: resolvedBlocks as unknown as object[],
          isEdited: true,
          editedAt: new Date(),
        }),
        ...(input.hashtags !== undefined && { hashtags: input.hashtags }),
        ...(input.isPinned !== undefined && { isPinned: input.isPinned }),
      } as any,
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
        attachments: true,
        reactions: { select: { emoji: true, userId: true } },
        seenBy: { select: { userId: true } },
      },
    });

    await this.linkAttachments(postId, resolvedBlocks);
    return this.mapToDto(updated, requesterId);
  }

  async softDelete(postId: string, requesterId: string): Promise<{ message: string }> {
    await this.findPostOrFail(postId);

    const attachments = await this.prisma.newsletterAttachment.findMany({ where: { postId } });
    await Promise.all(attachments.map((a) => this.uploadsService.deleteFile(a.fileKey)));

    await this.prisma.newsletterPost.update({ where: { id: postId }, data: { deletedAt: new Date() } });
    return { message: 'پست حذف شد' };
  }

  async markSeen(postId: string, userId: string): Promise<void> {
    await this.findPostOrFail(postId);
    try {
      await this.prisma.newsletterSeen.upsert({
        where: { postId_userId: { postId, userId } },
        create: { postId, userId },
        update: {},
      });
    } catch {
      // P2002: unique constraint — record already exists, which is fine
    }
  }

  async react(postId: string, userId: string, emoji: ReactionEmoji): Promise<ReactionSummaryDto> {
    await this.findPostOrFail(postId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = emoji as any;
    await this.prisma.newsletterReaction.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId, emoji: e },
      update: { emoji: e },
    });
    return this.getReactionSummary(postId);
  }

  async removeReaction(postId: string, userId: string): Promise<ReactionSummaryDto> {
    await this.prisma.newsletterReaction.deleteMany({ where: { postId, userId } });
    return this.getReactionSummary(postId);
  }

  async getSeenList(postId: string, page: number, limit: number) {
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

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async resolveBlocks(
    blocks?: NewsletterBlock[],
    uploads?: Record<string, BlockUpload>,
  ): Promise<NewsletterBlock[]> {
    if (!blocks || blocks.length === 0) return [];

    const resolved: NewsletterBlock[] = [];
    for (const block of blocks) {
      if (block.type === 'TEXT' || block.attachmentId) {
        resolved.push(block);
        continue;
      }
      const upload = uploads?.[block.id];
      if (!upload) { resolved.push(block); continue; }

      const existing = await this.prisma.newsletterAttachment.findFirst({
        where: { fileKey: upload.fileKey },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const attachmentId = existing?.id ?? (await this.prisma.newsletterAttachment.create({
        data: {
          fileName: upload.fileName,
          fileKey: upload.fileKey,
          fileUrl: upload.fileUrl,
          mimeType: upload.mimeType,
          fileSize: upload.fileSize,
          duration: upload.duration ?? null,
        } as any,
      })).id;

      resolved.push({
        ...block,
        attachmentId,
        meta: {
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          fileSize: upload.fileSize,
          duration: upload.duration ?? null,
        },
      });
    }
    return resolved.sort((a, b) => a.order - b.order);
  }

  private async linkAttachments(postId: string, blocks: NewsletterBlock[]): Promise<void> {
    const ids = blocks.filter((b) => b.attachmentId).map((b) => b.attachmentId as string);
    if (ids.length > 0) {
      await this.prisma.newsletterAttachment.updateMany({
        where: { id: { in: ids }, postId: undefined },
        data: { postId },
      });
    }
  }

  private async getReactionSummary(postId: string): Promise<ReactionSummaryDto> {
    const reactions = await this.prisma.newsletterReaction.findMany({ where: { postId }, select: { emoji: true } });
    const summary: ReactionSummaryDto = {};
    for (const r of reactions) summary[r.emoji] = (summary[r.emoji] ?? 0) + 1;
    return summary;
  }

  private async findPostOrFail(postId: string): Promise<NewsletterPost> {
    const post = await this.prisma.newsletterPost.findUnique({ where: { id: postId, deletedAt: null } });
    if (!post) throw new NotFoundException('پست یافت نشد');
    return post;
  }

  private mapToDto(post: PostWithRelations, requesterId: string): NewsletterPostDto {
    const reactionSummary: ReactionSummaryDto = {};
    let myReaction: ReactionEmoji | null = null;
    for (const r of post.reactions) {
      reactionSummary[r.emoji] = (reactionSummary[r.emoji] ?? 0) + 1;
      if (r.userId === requesterId) myReaction = r.emoji as ReactionEmoji;
    }
    const contentBlocks: NewsletterBlock[] = Array.isArray(post.contentBlocks)
      ? (post.contentBlocks as unknown as NewsletterBlock[])
      : [];

    return {
      id: post.id,
      title: post.title ?? null,
      body: post.body,
      contentBlocks,
      hashtags: post.hashtags ?? [],
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
      updatedAt: post.updatedAt.toISOString(),
    };
  }

  private mapAttachment(att: NewsletterAttachment): NewsletterAttachmentDto {
    return { id: att.id, fileName: att.fileName, fileKey: att.fileKey, fileUrl: att.fileUrl, mimeType: att.mimeType, fileSize: att.fileSize, duration: att.duration };
  }
}
