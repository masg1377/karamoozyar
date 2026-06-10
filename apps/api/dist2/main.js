"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const helmet_1 = __importDefault(require("helmet"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const app_module_1 = require("./app.module");
async function bootstrap() {
    const logger = new common_1.Logger('Bootstrap');
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { logger: ['log', 'warn', 'error', 'debug'] });
    // ─── Security ──────────────────────────────────────────────────
    app.use((0, helmet_1.default)());
    app.use((0, cookie_parser_1.default)());
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
bootstrap().catch((err) => {
    console.error('Failed to start application:', err);
    process.exit(1);
});
