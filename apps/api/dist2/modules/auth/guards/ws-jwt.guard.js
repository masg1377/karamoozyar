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
var WsJwtGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WsJwtGuard = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const websockets_1 = require("@nestjs/websockets");
const prisma_service_1 = require("../../../prisma/prisma.service");
let WsJwtGuard = WsJwtGuard_1 = class WsJwtGuard {
    jwtService;
    configService;
    prisma;
    logger = new common_1.Logger(WsJwtGuard_1.name);
    constructor(jwtService, configService, prisma) {
        this.jwtService = jwtService;
        this.configService = configService;
        this.prisma = prisma;
    }
    async canActivate(context) {
        const client = context.switchToWs().getClient();
        const token = this.extractTokenFromSocket(client);
        if (!token) {
            throw new websockets_1.WsException('توکن احراز هویت یافت نشد');
        }
        try {
            const payload = this.jwtService.verify(token, {
                secret: this.configService.get('jwt', { infer: true }).accessSecret,
            });
            const user = await this.prisma.user.findUnique({
                where: { id: payload.sub, isActive: true, deletedAt: null },
                select: { id: true, role: true, nationalId: true },
            });
            if (!user) {
                throw new websockets_1.WsException('کاربر یافت نشد');
            }
            client.user = { sub: user.id, nationalId: user.nationalId, role: user.role };
            return true;
        }
        catch {
            throw new websockets_1.WsException('توکن نامعتبر است');
        }
    }
    extractTokenFromSocket(client) {
        const authHeader = client.handshake.auth['token'];
        if (authHeader?.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        return authHeader ?? null;
    }
};
exports.WsJwtGuard = WsJwtGuard;
exports.WsJwtGuard = WsJwtGuard = WsJwtGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        config_1.ConfigService,
        prisma_service_1.PrismaService])
], WsJwtGuard);
