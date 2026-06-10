import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { SendOtpSchema, VerifyOtpSchema, RefreshTokenSchema } from '@karamooziyar/shared';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard, IS_PUBLIC_KEY } from './guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '@karamooziyar/shared';
import type { JwtRefreshPayload } from './strategies/jwt-refresh.strategy';
import { Role } from '@karamooziyar/shared';
import { AuthGuard } from '@nestjs/passport';

const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(SendOtpSchema))
  async sendOtp(
    @Body() body: { identifier?: string; nationalId?: string },
  ): Promise<{ message: string; expiresIn: number }> {
    // Support both new (identifier) and legacy (nationalId) clients
    const id = body.identifier ?? body.nationalId ?? '';
    return this.authService.sendOtp(id);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(VerifyOtpSchema))
  async verifyOtp(
    @Body() body: { identifier?: string; nationalId?: string; otp: string },
    @Req() req: Request,
  ) {
    const id = body.identifier ?? body.nationalId ?? '';
    return this.authService.verifyOtp(id, body.otp, req.ip, req.headers['user-agent']);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt-refresh'))
  async refreshToken(@CurrentUser() user: JwtRefreshPayload) {
    return this.authService.refreshTokens(user.sub, user.nationalId, user.role as Role, user.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Body() body: { refreshToken?: string },
  ): Promise<{ message: string }> {
    await this.authService.logout(user.sub, body.refreshToken);
    return { message: 'خروج موفق' };
  }
}
