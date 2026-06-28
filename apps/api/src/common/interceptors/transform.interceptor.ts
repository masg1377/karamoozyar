import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface SuccessResponse<T> {
  success: true;
  data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, SuccessResponse<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessResponse<T> | T> {
    // Only wrap HTTP responses. WebSocket handler return values are sent back
    // verbatim as Socket.IO acknowledgements (e.g. the typed CHAT_SEND ack) and
    // must NOT be wrapped in { success, data }, or clients can't read them.
    if (context.getType() !== 'http') {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
      })),
    );
  }
}
