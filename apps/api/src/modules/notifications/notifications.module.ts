import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';
import { SmsProviderService } from './sms.provider';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule],
  providers: [NotificationsService, SmsProviderService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
