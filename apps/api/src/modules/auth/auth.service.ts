import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import type { JwtPayload, AuthTokens, UserDto } from '@karamooziyar/shared';
import { Role } from '@karamooziyar/shared';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SmsProviderService } from '../notifications/sms.provider';

/**
 * Normalize an Iranian mobile number to the canonical 09xxxxxxxxx format.
 * Accepts: 09121234567 | +989121234567 | 989121234567
 * Returns: "09121234567" or null if not a valid Iranian mobile number.
 */
function normalizeIranianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('98') && digits.length === 12) {
    return '0' + digits.slice(2); // 989121234567 → 09121234567
  }
  if (digits.startsWith('09') && digits.length === 11) {
    return digits;
  }
  return null;
}

/**
 * Resolve an identifier (nationalId or phone) to a Redis OTP key.
 * We use nationalId as the OTP key so both flows share the same logic.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly sms: SmsProviderService,
  ) {}

  /**
   * Resolve identifier string to a user record.
   * Tries nationalId first; if that fails, tries normalized phone number.
   */
  private async resolveUser(identifier: string): Promise<{ id: string; nationalId: string; firstName: string } | null> {
    // Try nationalId (10 digits)
    if (/^\d{10}$/.test(identifier)) {
      const byNationalId = await this.prisma.user.findFirst({
        where: { nationalId: identifier, isActive: true, deletedAt: null },
        select: { id: true, nationalId: true, firstName: true },
      });
      if (byNationalId) return byNationalId;
    }

    // Try phone
    const normalized = normalizeIranianPhone(identifier);
    if (normalized) {
      const byPhone = await this.prisma.user.findFirst({
        where: { phoneNumber: normalized, isActive: true, deletedAt: null },
        select: { id: true, nationalId: true, firstName: true },
      });
      if (byPhone) return byPhone;
    }

    return null;
  }

  async sendOtp(identifier: string): Promise<{ message: string; expiresIn: number }> {
    // Resolve user and get their phone number for SMS delivery
    const userBase = await this.resolveUser(identifier);
    if (!userBase) throw new NotFoundException('کد ملی یا شماره موبایل معتبر نیست');

    // Fetch full record to get phoneNumber
    const user = await this.prisma.user.findUnique({
      where: { nationalId: userBase.nationalId },
      select: { nationalId: true, firstName: true, phoneNumber: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    const otpConfig = this.configService.get('otp', { infer: true });

    const otp =
      otpConfig.fixedCode ??
      Math.floor(Math.pow(10, otpConfig.length - 1) + Math.random() * 9 * Math.pow(10, otpConfig.length - 1))
        .toString()
        .substring(0, otpConfig.length);

    const otpHash = await bcrypt.hash(otp, 8);
    await this.redis.setOtp(user.nationalId, otpHash, otpConfig.expirySeconds);

    // In development: log OTP to console (SmsProviderService.sendOtp does this)
    // In production: deliver via PishgamRayan SMS API
    this.logger.log(`📱 OTP for ${user.nationalId}: ${otp} (expires in ${otpConfig.expirySeconds}s)`);
    if (user.phoneNumber) {
      // Fire-and-forget; do not block login flow on SMS failure
      void this.sms.sendOtp(user.phoneNumber, otp).then((result) => {
        if (!result.success)
          this.logger.warn(`OTP SMS delivery failed: ${result.error}`);
      });
    }

    return {
      message: `کد تأیید ارسال شد${process.env['NODE_ENV'] === 'development' ? ` (DEV: ${otp})` : ''}`,
      expiresIn: otpConfig.expirySeconds,
    };
  }

  async verifyOtp(
    identifier: string,
    otp: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ tokens: AuthTokens; user: UserDto }> {
    const resolved = await this.resolveUser(identifier);

    if (!resolved) {
      throw new UnauthorizedException('کد ملی یا شماره موبایل معتبر نیست');
    }

    const storedHash = await this.redis.getOtp(resolved.nationalId);

    if (!storedHash) {
      throw new UnauthorizedException('کد منقضی شده یا ارسال نشده است');
    }

    const isValid = await bcrypt.compare(otp, storedHash);
    if (!isValid) {
      throw new UnauthorizedException('کد وارد شده نادرست است');
    }

    await this.redis.deleteOtp(resolved.nationalId);

    const user = await this.prisma.user.findUnique({
      where: { nationalId: resolved.nationalId, isActive: true, deletedAt: null },
    });

    if (!user) {
      throw new UnauthorizedException('کاربر یافت نشد');
    }

    const tokens = await this.generateTokens(user.id, user.nationalId, user.role as Role);
    await this.saveRefreshToken(user.id, tokens.refreshToken, ipAddress, userAgent);

    return { tokens, user: this.mapUserToDto(user) };
  }

  async refreshTokens(
    userId: string,
    nationalId: string,
    role: Role,
    rawRefreshToken: string,
  ): Promise<{ accessToken: string }> {
    const storedTokens = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });

    let validToken = null;
    for (const token of storedTokens) {
      const match = await bcrypt.compare(rawRefreshToken, token.tokenHash);
      if (match) { validToken = token; break; }
    }

    if (!validToken) throw new UnauthorizedException('Refresh token نامعتبر یا منقضی شده');

    const jwtConfig = this.configService.get('jwt', { infer: true });
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = { sub: userId, nationalId, role };

    const accessToken = this.jwtService.sign(payload, {
      secret: jwtConfig.accessSecret,
      expiresIn: jwtConfig.accessExpiresIn,
    });

    return { accessToken };
  }

  async logout(userId: string, rawRefreshToken?: string): Promise<void> {
    if (rawRefreshToken) {
      const tokens = await this.prisma.refreshToken.findMany({ where: { userId, revokedAt: null } });
      for (const token of tokens) {
        const match = await bcrypt.compare(rawRefreshToken, token.tokenHash);
        if (match) {
          await this.prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
          break;
        }
      }
    } else {
      await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
  }

  private async generateTokens(userId: string, nationalId: string, role: Role): Promise<AuthTokens> {
    const jwtConfig = this.configService.get('jwt', { infer: true });
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = { sub: userId, nationalId, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { secret: jwtConfig.accessSecret, expiresIn: jwtConfig.accessExpiresIn }),
      this.jwtService.signAsync(payload, { secret: jwtConfig.refreshSecret, expiresIn: jwtConfig.refreshExpiresIn, jwtid: uuidv4() }),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(userId: string, rawToken: string, ipAddress?: string, userAgent?: string): Promise<void> {
    const tokenHash = await bcrypt.hash(rawToken, 8);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90); // هم‌راستا با JWT_REFRESH_EXPIRES_IN=90d
    await this.prisma.refreshToken.create({ data: { userId, tokenHash, ipAddress, userAgent, expiresAt } });
  }

  private mapUserToDto(user: {
    id: string; firstName: string; lastName: string; nationalId: string;
    phoneNumber: string; judicialDomain: string; expertiseField: string;
    role: string; isActive: boolean; avatarUrl: string | null; createdAt: Date; updatedAt: Date;
  }): UserDto {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      nationalId: user.nationalId,
      phoneNumber: user.phoneNumber,
      judicialDomain: user.judicialDomain,
      expertiseField: user.expertiseField,
      role: user.role as Role,
      isActive: user.isActive,
      avatarUrl: user.avatarUrl,
      profileImageUrl: null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
