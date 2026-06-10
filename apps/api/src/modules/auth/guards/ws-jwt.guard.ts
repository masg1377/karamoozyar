import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import type { JwtPayload } from '@karamooziyar/shared';
import type { AppConfig } from '../../../config/configuration';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket & { user?: JwtPayload }>();
    const token = this.extractTokenFromSocket(client);

    if (!token) {
      throw new WsException('توکن احراز هویت یافت نشد');
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get('jwt', { infer: true }).accessSecret,
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub, isActive: true, deletedAt: null },
        select: { id: true, role: true, nationalId: true },
      });

      if (!user) {
        throw new WsException('کاربر یافت نشد');
      }

      client.user = { sub: user.id, nationalId: user.nationalId, role: user.role as JwtPayload['role'] };
      return true;
    } catch {
      throw new WsException('توکن نامعتبر است');
    }
  }

  private extractTokenFromSocket(client: Socket): string | null {
    const authHeader = client.handshake.auth['token'] as string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return authHeader ?? null;
  }
}
