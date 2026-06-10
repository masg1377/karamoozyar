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
exports.AdminService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let AdminService = class AdminService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getStats() {
        const [totalUsers, activeUsers, totalConversations, unreadConversations, totalNewsletterPosts, totalMessages,] = await Promise.all([
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
};
exports.AdminService = AdminService;
exports.AdminService = AdminService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminService);
