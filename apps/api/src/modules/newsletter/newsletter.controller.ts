import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NewsletterService } from './newsletter.service';
import { PushService } from '../push/push.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  type JwtPayload,
  ReactToPostSchema,
  CursorPaginationSchema,
  PagePaginationSchema,
  CreateNewsletterPostSchema,
  UpdateNewsletterPostSchema,
  type ReactToPostInput,
  type CreateNewsletterPostInput,
  type UpdateNewsletterPostInput,
  ReactionEmoji,
} from '@karamooziyar/shared';

@Controller('newsletter')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NewsletterController {
  constructor(
    private readonly newsletterService: NewsletterService,
    private readonly pushService: PushService,
  ) {}

  @Get()
  findAll(
    @Query(new ZodValidationPipe(CursorPaginationSchema))
    query: { cursor?: string; limit: number },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.newsletterService.findAll(user.sub, query.cursor, query.limit);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.newsletterService.findOne(id, user.sub);
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(
    @Body(new ZodValidationPipe(CreateNewsletterPostSchema)) body: CreateNewsletterPostInput,
    @CurrentUser() user: JwtPayload,
  ) {
    const post = await this.newsletterService.create(user.sub, body);
    // اعلان درون‌برنامه‌ای + وب‌پوش برای کارآموزان
    this.pushService.notifyNewsletterPost({ id: post.id, title: post.title, body: post.body });
    return post;
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateNewsletterPostSchema)) body: UpdateNewsletterPostInput,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.newsletterService.update(id, user.sub, body);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.newsletterService.softDelete(id, user.sub);
  }

  @Post(':id/seen')
  markSeen(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.newsletterService.markSeen(id, user.sub);
  }

  @Post(':id/react')
  react(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReactToPostSchema)) body: ReactToPostInput,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.newsletterService.react(id, user.sub, body.emoji as ReactionEmoji);
  }

  @Delete(':id/react')
  removeReaction(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.newsletterService.removeReaction(id, user.sub);
  }

  @Get(':id/seen-list')
  @Roles(Role.ADMIN)
  getSeenList(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(PagePaginationSchema))
    query: { page: number; limit: number },
  ) {
    return this.newsletterService.getSeenList(id, query.page, query.limit);
  }
}
