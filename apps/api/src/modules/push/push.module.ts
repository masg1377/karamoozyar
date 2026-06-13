import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/**
 * Self-hosted Web Push (VAPID) — no third-party push provider.
 * Global so the chat gateway and feature modules can deliver
 * notifications without extra wiring.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
