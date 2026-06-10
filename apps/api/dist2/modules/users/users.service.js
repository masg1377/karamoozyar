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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let UsersService = class UsersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(page, limit, search) {
        const where = {
            deletedAt: null,
            role: 'USER',
            ...(search
                ? {
                    OR: [
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                        { nationalId: { contains: search } },
                        { phoneNumber: { contains: search } },
                    ],
                }
                : {}),
        };
        const [users, total] = await Promise.all([
            this.prisma.user.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.user.count({ where }),
        ]);
        return {
            data: users.map(this.mapToDto),
            meta: { total, page, limit },
        };
    }
    async findById(id) {
        const user = await this.prisma.user.findUnique({
            where: { id, deletedAt: null },
        });
        if (!user)
            throw new common_1.NotFoundException('کاربر یافت نشد');
        return this.mapToProfileDto(user);
    }
    async findByNationalId(nationalId) {
        const user = await this.prisma.user.findUnique({
            where: { nationalId, deletedAt: null },
        });
        if (!user)
            throw new common_1.NotFoundException('کاربر یافت نشد');
        return this.mapToProfileDto(user);
    }
    async create(input) {
        const existing = await this.prisma.user.findFirst({
            where: {
                OR: [{ nationalId: input.nationalId }, { phoneNumber: input.phoneNumber }],
                deletedAt: null,
            },
        });
        if (existing) {
            if (existing.nationalId === input.nationalId) {
                throw new common_1.ConflictException('کاربری با این شماره ملی قبلاً ثبت شده است');
            }
            throw new common_1.ConflictException('کاربری با این شماره تماس قبلاً ثبت شده است');
        }
        const user = await this.prisma.user.create({
            data: { ...input, role: 'USER' },
        });
        // Auto-create conversation for the new user
        await this.prisma.conversation.create({ data: { userId: user.id } });
        return this.mapToDto(user);
    }
    async update(id, input) {
        await this.findById(id);
        if (input.phoneNumber) {
            const conflict = await this.prisma.user.findFirst({
                where: { phoneNumber: input.phoneNumber, id: { not: id }, deletedAt: null },
            });
            if (conflict)
                throw new common_1.ConflictException('این شماره تماس قبلاً استفاده شده است');
        }
        const user = await this.prisma.user.update({
            where: { id },
            data: input,
        });
        return this.mapToDto(user);
    }
    async softDelete(id) {
        await this.findById(id);
        await this.prisma.user.update({
            where: { id },
            data: { deletedAt: new Date(), isActive: false },
        });
        return { message: 'کاربر غیرفعال شد' };
    }
    mapToDto(user) {
        return {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            nationalId: user.nationalId,
            phoneNumber: user.phoneNumber,
            judicialDomain: user.judicialDomain,
            expertiseField: user.expertiseField,
            role: user.role,
            isActive: user.isActive,
            avatarUrl: user.avatarUrl,
            createdAt: user.createdAt.toISOString(),
        };
    }
    mapToProfileDto(user) {
        return {
            ...this.mapToDto(user),
            updatedAt: user.updatedAt.toISOString(),
        };
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersService);
