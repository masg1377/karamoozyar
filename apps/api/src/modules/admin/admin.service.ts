import { Injectable } from '@nestjs/common';
import type { AdminStatsDto } from '@karamooziyar/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<AdminStatsDto> {
    const [
      totalUsers,
      activeUsers,
      totalConversations,
      unreadConversations,
      totalNewsletterPosts,
      totalMessages,
      latestNewsletterPost,
      latestUnreadConversation,
      latestActiveUser,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'USER', deletedAt: null } }),
      this.prisma.user.count({ where: { role: 'USER', isActive: true, deletedAt: null } }),
      this.prisma.conversation.count(),
      this.prisma.conversation.count({ where: { unreadByAdmin: { gt: 0 } } }),
      this.prisma.newsletterPost.count({ where: { deletedAt: null } }),
      this.prisma.message.count({ where: { deletedAt: null } }),
      this.prisma.newsletterPost.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, isEdited: true, createdAt: true },
      }),
      this.prisma.conversation.findFirst({
        where: { unreadByAdmin: { gt: 0 }, lastMessageAt: { not: null } },
        orderBy: { lastMessageAt: 'desc' },
        select: { lastMessageAt: true },
      }),
      this.prisma.user.findFirst({
        where: { role: 'USER', deletedAt: null, lastSeenAt: { not: null } },
        orderBy: { lastSeenAt: 'desc' },
        select: { id: true, firstName: true, lastName: true, lastSeenAt: true },
      }),
    ]);

    return {
      totalUsers,
      activeUsers,
      totalConversations,
      unreadConversations,
      totalNewsletterPosts,
      totalMessages,
      recentActivity: {
        latestNewsletterPost: latestNewsletterPost
          ? {
              id: latestNewsletterPost.id,
              title: latestNewsletterPost.title,
              isEdited: latestNewsletterPost.isEdited,
              createdAt: latestNewsletterPost.createdAt.toISOString(),
            }
          : null,
        latestUnreadAt: latestUnreadConversation?.lastMessageAt?.toISOString() ?? null,
        latestActiveUser: latestActiveUser
          ? {
              id: latestActiveUser.id,
              firstName: latestActiveUser.firstName,
              lastName: latestActiveUser.lastName,
              // lastSeenAt is guaranteed non-null by the `not: null` filter above
              lastSeenAt: latestActiveUser.lastSeenAt!.toISOString(),
            }
          : null,
      },
    };
  }
}
