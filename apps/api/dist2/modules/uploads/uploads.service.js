"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var UploadsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const uuid_1 = require("uuid");
const path = __importStar(require("path"));
const shared_1 = require("@karamooziyar/shared");
const shared_2 = require("@karamooziyar/shared");
let UploadsService = UploadsService_1 = class UploadsService {
    configService;
    logger = new common_1.Logger(UploadsService_1.name);
    s3;
    bucketName;
    constructor(configService) {
        this.configService = configService;
        const s3Config = this.configService.get('s3', { infer: true });
        this.bucketName = s3Config.bucketName;
        this.s3 = new client_s3_1.S3Client({
            endpoint: s3Config.useSsl ? undefined : s3Config.endpoint,
            region: s3Config.region,
            credentials: {
                accessKeyId: s3Config.accessKey,
                secretAccessKey: s3Config.secretKey,
            },
            forcePathStyle: !s3Config.useSsl, // Required for MinIO
        });
    }
    async uploadMessageAttachment(file, conversationId) {
        this.validateFile(file);
        const folder = `messages/${conversationId}`;
        return this.uploadFile(file, folder);
    }
    async uploadNewsletterAttachment(file) {
        this.validateFile(file);
        return this.uploadFile(file, 'newsletter');
    }
    async getPresignedUrl(fileKey, expiresIn = 3600) {
        const command = new client_s3_1.GetObjectCommand({ Bucket: this.bucketName, Key: fileKey });
        return (0, s3_request_presigner_1.getSignedUrl)(this.s3, command, { expiresIn });
    }
    async deleteFile(fileKey) {
        try {
            await this.s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: this.bucketName, Key: fileKey }));
        }
        catch (err) {
            this.logger.error(`Failed to delete file: ${fileKey}`, err);
        }
    }
    detectMessageType(mimeType) {
        if (shared_1.IMAGE_MIME_TYPES.includes(mimeType))
            return shared_2.MessageType.IMAGE;
        if (shared_1.VOICE_MIME_TYPES.includes(mimeType))
            return shared_2.MessageType.VOICE;
        return shared_2.MessageType.FILE;
    }
    validateFile(file) {
        if (!file)
            throw new common_1.BadRequestException('فایلی ارسال نشده است');
        if (file.size > shared_1.FILE_LIMITS.MAX_SIZE_BYTES) {
            throw new common_1.BadRequestException(`حجم فایل نباید بیشتر از ${shared_1.FILE_LIMITS.MAX_SIZE_MB} مگابایت باشد`);
        }
        if (!shared_1.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            throw new common_1.BadRequestException('نوع فایل مجاز نیست');
        }
    }
    async uploadFile(file, folder) {
        const ext = path.extname(file.originalname).toLowerCase();
        const fileKey = `${folder}/${(0, uuid_1.v4)()}${ext}`;
        try {
            await this.s3.send(new client_s3_1.PutObjectCommand({
                Bucket: this.bucketName,
                Key: fileKey,
                Body: file.buffer,
                ContentType: file.mimetype,
                ContentLength: file.size,
                Metadata: {
                    originalName: Buffer.from(file.originalname).toString('base64'),
                },
            }));
        }
        catch (err) {
            this.logger.error('S3 upload failed', err);
            throw new common_1.InternalServerErrorException('آپلود فایل ناموفق بود');
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
};
exports.UploadsService = UploadsService;
exports.UploadsService = UploadsService = UploadsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], UploadsService);
