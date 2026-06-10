import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import type { AppConfig } from '../../config/configuration';
import { ALLOWED_MIME_TYPES, FILE_LIMITS, IMAGE_MIME_TYPES, VOICE_MIME_TYPES } from '@karamooziyar/shared';
import { MessageType } from '@karamooziyar/shared';

export interface UploadResult {
  fileKey: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  duration: number | null;
}

@Injectable()
export class UploadsService implements OnModuleInit {
  private readonly logger = new Logger(UploadsService.name);
  private readonly s3: S3Client;
  private readonly bucketName: string;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    const s3Config = this.configService.get('s3', { infer: true });
    this.bucketName = s3Config.bucketName;

    this.s3 = new S3Client({
      endpoint: s3Config.useSsl ? undefined : s3Config.endpoint,
      region: s3Config.region,
      credentials: {
        accessKeyId: s3Config.accessKey,
        secretAccessKey: s3Config.secretKey,
      },
      forcePathStyle: !s3Config.useSsl, // Required for MinIO
    });
  }

  async onModuleInit(): Promise<void> {
    // Ensure bucket exists
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      this.logger.log(`S3 bucket "${this.bucketName}" already exists`);
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucketName }));
        this.logger.log(`S3 bucket "${this.bucketName}" created successfully`);
      } catch (err) {
        this.logger.warn(`Could not create S3 bucket: ${(err as Error).message}`);
      }
    }

    // Set public read policy for profiles/ prefix so avatars can be served without signed URLs
    try {
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PublicReadProfiles',
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${this.bucketName}/profiles/*`,
          },
        ],
      };
      await this.s3.send(
        new PutBucketPolicyCommand({
          Bucket: this.bucketName,
          Policy: JSON.stringify(policy),
        }),
      );
      this.logger.log(`Public read policy applied for profiles/ prefix`);
    } catch (err) {
      this.logger.warn(`Could not set bucket policy: ${(err as Error).message}`);
    }
  }

  async uploadProfileImage(file: Express.Multer.File, userId: string): Promise<UploadResult> {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('حجم عکس پروفایل نباید بیشتر از ۵ مگابایت باشد');
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype))
      throw new BadRequestException('فقط تصویر مجاز است (JPEG, PNG, WebP)');
    return this.uploadFile(file, `profiles/${userId}`);
  }

  async uploadMessageAttachment(
    file: Express.Multer.File,
    conversationId: string,
  ): Promise<UploadResult> {
    this.validateFile(file);
    const folder = `messages/${conversationId}`;
    return this.uploadFile(file, folder);
  }

  async uploadNewsletterAttachment(file: Express.Multer.File): Promise<UploadResult> {
    this.validateFile(file);
    return this.uploadFile(file, 'newsletter');
  }

  async getPresignedUrl(fileKey: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: fileKey });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  async deleteFile(fileKey: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: fileKey }));
    } catch (err) {
      this.logger.error(`Failed to delete file: ${fileKey}`, err);
    }
  }

  detectMessageType(mimeType: string): MessageType {
    if ((IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) return MessageType.IMAGE;
    if ((VOICE_MIME_TYPES as readonly string[]).includes(mimeType)) return MessageType.VOICE;
    return MessageType.FILE;
  }

  private validateFile(file: Express.Multer.File): void {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');

    if (file.size > FILE_LIMITS.MAX_SIZE_BYTES) {
      throw new BadRequestException(
        `حجم فایل نباید بیشتر از ${FILE_LIMITS.MAX_SIZE_MB} مگابایت باشد`,
      );
    }

    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException('نوع فایل مجاز نیست');
    }
  }

  private async uploadFile(file: Express.Multer.File, folder: string): Promise<UploadResult> {
    const ext = path.extname(file.originalname).toLowerCase();
    const fileKey = `${folder}/${uuidv4()}${ext}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: fileKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          ContentLength: file.size,
          Metadata: {
            originalName: Buffer.from(file.originalname).toString('base64'),
          },
        }),
      );
    } catch (err) {
      this.logger.error('S3 upload failed', err);
      throw new InternalServerErrorException('آپلود فایل ناموفق بود');
    }

    const s3Config = this.configService.get('s3', { infer: true });
    const fileUrl = s3Config.useSsl
      ? `https://s3.${s3Config.region}.amazonaws.com/${this.bucketName}/${fileKey}`
      : `${s3Config.endpoint}/${this.bucketName}/${fileKey}`;

    return {
      fileKey,
      fileUrl,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      duration: null,
    };
  }

  /**
   * Upload a newsletter attachment and immediately persist a DB record (postId = null).
   * Returns the attachment id so the client can reference it in contentBlocks.
   */
  async uploadAndRecordNewsletterAttachment(
    file: Express.Multer.File,
  ): Promise<UploadResult & { id: string }> {
    const result = await this.uploadNewsletterAttachment(file);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = await this.prisma.newsletterAttachment.create({
        data: {
          fileName: result.fileName,
          fileKey: result.fileKey,
          fileUrl: result.fileUrl,
          mimeType: result.mimeType,
          fileSize: result.fileSize,
          duration: result.duration,
        } as any,
      });
      return { ...result, id: record.id };
    } catch (err) {
      // DB record creation failed (e.g. migration not yet applied).
      // Still return the upload result — the newsletter service will create the record on publish.
      this.logger.warn('Could not pre-create newsletter attachment record: ' + (err as Error).message);
      return { ...result, id: result.fileKey };
    }
  }

  /**
   * Get a short-lived pre-signed URL for an attachment, checking permissions.
   * type = 'newsletter' → any authenticated user/admin
   * type = 'message'    → owner user or admin
   */
  async getSignedUrlForAttachment(
    attachmentId: string,
    type: 'newsletter' | 'message',
    requesterId: string,
    requesterRole: string,
  ): Promise<string> {
    let fileKey: string;

    if (type === 'newsletter') {
      const att = await this.prisma.newsletterAttachment.findUnique({
        where: { id: attachmentId },
      });
      if (!att) throw new NotFoundException('فایل پیدا نشد');
      fileKey = att.fileKey;
    } else {
      const att = await this.prisma.messageAttachment.findUnique({
        where: { id: attachmentId },
        include: { message: { select: { conversation: { select: { userId: true } } } } },
      });
      if (!att) throw new NotFoundException('فایل پیدا نشد');
      // Only admin or the conversation owner can access message attachments
      if (requesterRole !== 'ADMIN') {
        const conversationUserId = att.message.conversation?.userId;
        if (conversationUserId !== requesterId) {
          throw new ForbiddenException('دسترسی غیرمجاز');
        }
      }
      fileKey = att.fileKey;
    }

    return this.getPresignedUrl(fileKey, 3600);
  }
}
