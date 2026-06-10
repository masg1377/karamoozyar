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
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'USER', deletedAt: null } }),
      this.prisma.user.count({ where: { role: 'USER', isActive: true, deletedAt: null } }),
      this.prisma.conversation.count(),
      this.prisma.conversation.count({ where: { unreadByAdmin: { gt: 0 } } }),
      this.prisma.newsletterPost.count({ where: { deletedAt: null } }),
      this.prisma.message.count({ where: { deletedAt: null } }),
    ]);

    return {
      totalUsers,
      activeUsers,
      totalConversations,
      unreadConversations,
      totalNewsletterPosts,
      totalMessages,
    };
  }
}
