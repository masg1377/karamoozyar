"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = __importStar(require("bcryptjs"));
const uuid_1 = require("uuid");
const prisma_service_1 = require("../../prisma/prisma.service");
const redis_service_1 = require("../../redis/redis.service");
let AuthService = AuthService_1 = class AuthService {
    prisma;
    redis;
    jwtService;
    configService;
    logger = new common_1.Logger(AuthService_1.name);
    constructor(prisma, redis, jwtService, configService) {
        this.prisma = prisma;
        this.redis = redis;
        this.jwtService = jwtService;
        this.configService = configService;
    }
    async sendOtp(nationalId) {
        const user = await this.prisma.user.findUnique({
            where: { nationalId, isActive: true, deletedAt: null },
            select: { id: true, firstName: true },
        });
        if (!user) {
            throw new common_1.NotFoundException('کاربری با این شماره ملی یافت نشد');
        }
        const otpConfig = this.configService.get('otp', { infer: true });
        // Use fixed OTP in dev mode if configured
        const otp = otpConfig.fixedCode ??
            Math.floor(Math.pow(10, otpConfig.length - 1) + Math.random() * 9 * Math.pow(10, otpConfig.length - 1))
                .toString()
                .substring(0, otpConfig.length);
        // Hash OTP before storing
        const otpHash = await bcrypt.hash(otp, 8);
        await this.redis.setOtp(nationalId, otpHash, otpConfig.expirySeconds);
        // In MVP, log OTP to console (replace with SMS in production)
        this.logger.log(`📱 OTP for ${nationalId}: ${otp} (expires in ${otpConfig.expirySeconds}s)`);
        return {
            message: `کد تأیید ارسال شد${process.env['NODE_ENV'] === 'development' ? ` (DEV: ${otp})` : ''}`,
            expiresIn: otpConfig.expirySeconds,
        };
    }
    async verifyOtp(nationalId, otp, ipAddress, userAgent) {
        const storedHash = await this.redis.getOtp(nationalId);
        if (!storedHash) {
            throw new common_1.UnauthorizedException('کد منقضی شده یا ارسال نشده است');
        }
        const isValid = await bcrypt.compare(otp, storedHash);
        if (!isValid) {
            throw new common_1.UnauthorizedException('کد وارد شده نادرست است');
        }
        // Delete OTP after successful use
        await this.redis.deleteOtp(nationalId);
        const user = await this.prisma.user.findUnique({
            where: { nationalId, isActive: true, deletedAt: null },
        });
        if (!user) {
            throw new common_1.UnauthorizedException('کاربر یافت نشد');
        }
        const tokens = await this.generateTokens(user.id, user.nationalId, user.role);
        await this.saveRefreshToken(user.id, tokens.refreshToken, ipAddress, userAgent);
        return {
            tokens,
            user: this.mapUserToDto(user),
        };
    }
    async refreshTokens(userId, nationalId, role, rawRefreshToken) {
        const tokenHash = await bcrypt.hash(rawRefreshToken, 8);
        // Find matching token by userId (we check hash later)
        const storedTokens = await this.prisma.refreshToken.findMany({
            where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        });
        let validToken = null;
        for (const token of storedTokens) {
            const match = await bcrypt.compare(rawRefreshToken, token.tokenHash);
            if (match) {
                validToken = token;
                break;
            }
        }
        if (!validToken) {
            throw new common_1.UnauthorizedException('Refresh token نامعتبر یا منقضی شده');
        }
        const jwtConfig = this.configService.get('jwt', { infer: true });
        const payload = { sub: userId, nationalId, role };
        const accessToken = this.jwtService.sign(payload, {
            secret: jwtConfig.accessSecret,
            expiresIn: jwtConfig.accessExpiresIn,
        });
        return { accessToken };
    }
    async logout(userId, rawRefreshToken) {
        if (rawRefreshToken) {
            const tokens = await this.prisma.refreshToken.findMany({
                where: { userId, revokedAt: null },
            });
            for (const token of tokens) {
                const match = await bcrypt.compare(rawRefreshToken, token.tokenHash);
                if (match) {
                    await this.prisma.refreshToken.update({
                        where: { id: token.id },
                        data: { revokedAt: new Date() },
                    });
                    break;
                }
            }
        }
        else {
            // Revoke all tokens
            await this.prisma.refreshToken.updateMany({
                where: { userId, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        }
    }
    async generateTokens(userId, nationalId, role) {
        const jwtConfig = this.configService.get('jwt', { infer: true });
        const payload = { sub: userId, nationalId, role };
        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(payload, {
                secret: jwtConfig.accessSecret,
                expiresIn: jwtConfig.accessExpiresIn,
            }),
            this.jwtService.signAsync(payload, {
                secret: jwtConfig.refreshSecret,
                expiresIn: jwtConfig.refreshExpiresIn,
                jwtid: (0, uuid_1.v4)(),
            }),
        ]);
        return { accessToken, refreshToken };
    }
    async saveRefreshToken(userId, rawToken, ipAddress, userAgent) {
        const tokenHash = await bcrypt.hash(rawToken, 8);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        await this.prisma.refreshToken.create({
            data: { userId, tokenHash, ipAddress, userAgent, expiresAt },
        });
    }
    mapUserToDto(user) {
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
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        jwt_1.JwtService,
        config_1.ConfigService])
], AuthService);
