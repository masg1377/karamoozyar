import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { JwtPayload, PushSubscriptionDto } from '@karamooziyar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PushService } from './push.service';

@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  /** VAPID public key — the browser needs it to create a subscription */
  @Get('public-key')
  getPublicKey(): { publicKey: string } {
    return { publicKey: this.pushService.getPublicKey() };
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  async subscribe(
    @CurrentUser() user: JwtPayload,
    @Body() body: PushSubscriptionDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    await this.pushService.subscribe(user.sub, body, userAgent);
  }

  @Delete('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsubscribe(
    @CurrentUser() user: JwtPayload,
    @Body() body: { endpoint: string },
  ): Promise<void> {
    await this.pushService.unsubscribe(user.sub, body.endpoint);
  }
}
