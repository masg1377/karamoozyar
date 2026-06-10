import { NestFactory, Reflector } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error', 'debug'] });

  // ─── Security ──────────────────────────────────────────────────
  app.use(helmet());
  app.use(cookieParser());

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
