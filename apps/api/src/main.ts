import { NestFactory, Reflector } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { join, isAbsolute } from 'path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });

  // ─── Security ──────────────────────────────────────────────────
  // CORP باید cross-origin باشد تا تصاویر/فایل‌های /files از origin فرانت لود شوند
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());

  // ─── Local uploads static serving (STORAGE_DRIVER=local) ───────
  // فایل‌های آپلودشده روی دیسک از مسیر /files/<fileKey> سرو می‌شوند
  const uploadDir = process.env['UPLOAD_DIR'] ?? 'uploads';
  const uploadPath = isAbsolute(uploadDir) ? uploadDir : join(process.cwd(), uploadDir);
  app.useStaticAssets(uploadPath, { prefix: '/files/', maxAge: '1d', index: false });

  // ─── CORS ──────────────────────────────────────────────────────
  const corsOrigins = (process.env['CORS_ORIGINS'] ?? 'http://localhost:3000').split(',');
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ─── API Prefix ────────────────────────────────────────────────
  const apiPrefix = process.env['API_PREFIX'] ?? 'api/v1';
  app.setGlobalPrefix(apiPrefix);

  // ─── Shutdown Hooks ────────────────────────────────────────────
  app.enableShutdownHooks();

  // ─── Start ─────────────────────────────────────────────────────
  const port = parseInt(process.env['PORT'] ?? '3001', 10);
  await app.listen(port);
  logger.log(`🚀 API is running on: http://localhost:${port}/${apiPrefix}`);
  logger.log(`🔌 WebSocket ready on: ws://localhost:${port}`);
  logger.log(`🌍 Environment: ${process.env['NODE_ENV'] ?? 'development'}`);
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
