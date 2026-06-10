import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request } from 'express';
import type { JwtPayload } from '@karamooziyar/shared';
import { PrismaService } from '../../prisma/prisma.service';

export const AUDIT_KEY = 'audit';
export interface AuditMeta {
  action: string;
  resource: string;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditMeta = this.reflector.get<AuditMeta | undefined>(AUDIT_KEY, context.getHandler());

    if (!auditMeta) {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload; params: Record<string, string> }>();
    const user = request.user;

    return next.handle().pipe(
      tap(() => {
        if (user) {
          void this.prisma.auditLog
            .create({
              data: {
                userId: user.sub,
                action: auditMeta.action,
                resource: auditMeta.resource,
                resourceId: request.params['id'] ?? undefined,
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'],
              },
            })
            .catch((err: Error) => this.logger.error('Audit log failed', err.message));
        }
      }),
    );
  }
}
