import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '@karamooziyar/shared';
import { FILE_LIMITS } from '@karamooziyar/shared';

@Controller('uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('message-attachment')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: FILE_LIMITS.MAX_SIZE_BYTES },
    }),
  )
  async uploadMessageAttachment(
    @UploadedFile() file: Express.Multer.File,
    @Query('conversationId') conversationId: string,
    @CurrentUser() _user: JwtPayload,
  ) {
    return this.uploadsService.uploadMessageAttachment(file, conversationId ?? 'general');
  }

  /**
   * Upload a newsletter attachment: stores in S3 AND creates a DB record.
   * Returns { id, fileKey, fileName, mimeType, fileSize } — id is used in contentBlocks.
   */
  @Post('newsletter-attachment')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: FILE_LIMITS.MAX_SIZE_BYTES },
    }),
  )
  async uploadNewsletterAttachment(@UploadedFile() file: Express.Multer.File) {
    return this.uploadsService.uploadAndRecordNewsletterAttachment(file);
  }

  /**
   * Get a short-lived signed URL for an attachment.
   * Checks JWT auth and verifies the requester has permission to access the file.
   * This is the correct fix for 401 on browser image/audio/video preview:
   * - Direct MinIO URLs are not public and require S3 auth headers
   * - Browser <img>/<audio>/<video> tags do NOT send Authorization headers
   * - Signed URLs are self-authenticating temporary URLs that work in any browser tag
   *
   * @param id   - attachment DB record id
   * @param type - 'newsletter' (any auth user) or 'message' (owner or admin)
   */
  @Get('attachments/:id/signed-url')
  async getAttachmentSignedUrl(
    @Param('id') id: string,
    @Query('type') type: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const attachmentType = type === 'message' ? 'message' : 'newsletter';
    const url = await this.uploadsService.getSignedUrlForAttachment(
      id,
      attachmentType,
      user.sub,
      user.role,
    );
    return { url, expiresIn: 3600 };
  }

  /**
   * Return a presigned URL for any S3 key (used by frontend to load avatars
   * without 401 — avatarUrl stored in DB may point to a private MinIO bucket).
   * Any authenticated user may call this.
   */
  @Get('presign')
  async presignKey(
    @Query('key') key: string,
    @CurrentUser() _user: JwtPayload,
  ) {
    if (!key) return { url: null };
    const url = await this.uploadsService.getPresignedUrl(key, 3600);
    return { url, expiresIn: 3600 };
  }
}
