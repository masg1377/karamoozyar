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
  UsePipes,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  type JwtPayload,
  SendMessageSchema,
  EditMessageSchema,
  CursorPaginationSchema,
  PagePaginationSchema,
  type SendMessageInput,
  type EditMessageInput,
} from '@karamooziyar/shared';

@Controller('conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  // Admin: list conversations (paginated, sorted by latest message, only those with messages)
  @Get()
  @Roles(Role.ADMIN)
  findAll(
    @Query(new ZodValidationPipe(PagePaginationSchema))
    query: { page: number; limit: number; search?: string },
  ) {
    return this.conversationsService.findAllForAdmin(query.page, query.limit, query.search);
  }

  // User: get my conversation
  @Get('mine')
  getMyConversation(@CurrentUser() user: JwtPayload) {
    return this.conversationsService.findForUser(user.sub);
  }

  // Admin: get conversation by user ID
  @Get('by-user/:userId')
  @Roles(Role.ADMIN)
  findByUserId(@Param('userId') userId: string) {
    return this.conversationsService.findByUserId(userId);
  }

  // Admin: get single conversation summary by conversation ID
  @Get(':id')
  @Roles(Role.ADMIN)
  findOne(@Param('id') id: string) {
    return this.conversationsService.findOneById(id);
  }

  // Get messages (paginated)
  @Get(':id/messages')
  getMessages(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(CursorPaginationSchema))
    query: { cursor?: string; limit: number },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.conversationsService.getMessages(id, user.sub, user.role, query.cursor, query.limit);
  }

  // Send a text message
  @Post(':id/messages')
  @UsePipes(new ZodValidationPipe(SendMessageSchema))
  async sendMessage(
    @Param('id') id: string,
    @Body() body: SendMessageInput,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.conversationsService.sendMessage(
      id,
      user.sub,
      user.role,
      body.body,
      body.type,
      body.fileKey,
    );
  }

  // Edit a message
  @Patch(':id/messages/:messageId')
  editMessage(
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(EditMessageSchema)) body: EditMessageInput,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.conversationsService.editMessage(messageId, user.sub, body.body);
  }

  // Delete a message (soft)
  @Delete(':id/messages/:messageId')
  deleteMessage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.conversationsService.deleteMessage(messageId, user.sub, user.role);
  }

  // Mark a message as seen
  @Post(':id/messages/:messageId/seen')
  markSeen(
    @Param('id') conversationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.conversationsService.markSeen(conversationId, messageId, user.sub);
  }

  // Get pinned messages for a conversation
  @Get(':id/pinned')
  getPinnedMessages(
    @Param('id') conversationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.conversationsService.getPinnedMessages(conversationId, user.sub, user.role);
  }

  // Pin a message
  @Patch(':id/messages/:messageId/pin')
  async pinMessage(
    @Param('id') conversationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.conversationsService.pinMessage(conversationId, messageId, user.sub, user.role);
  }

  // Unpin a message
  @Delete(':id/messages/:messageId/pin')
  async unpinMessage(
    @Param('id') conversationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.conversationsService.unpinMessage(conversationId, messageId, user.sub, user.role);
  }
}
