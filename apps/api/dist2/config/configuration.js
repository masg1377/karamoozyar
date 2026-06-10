"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => ({
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    port: parseInt(process.env['PORT'] ?? '3001', 10),
    apiPrefix: process.env['API_PREFIX'] ?? 'api/v1',
    frontendUrl: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
    corsOrigins: (process.env['CORS_ORIGINS'] ?? 'http://localhost:3000').split(','),
    database: {
        url: process.env['DATABASE_URL'] ?? '',
    },
    redis: {
        host: process.env['REDIS_HOST'] ?? 'localhost',
        port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
        password: process.env['REDIS_PASSWORD'] ?? '',
    },
    jwt: {
        accessSecret: process.env['JWT_ACCESS_SECRET'] ?? 'dev-access-secret',
        refreshSecret: process.env['JWT_REFRESH_SECRET'] ?? 'dev-refresh-secret',
        accessExpiresIn: (process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m'),
        refreshExpiresIn: (process.env['JWT_REFRESH_EXPIRES_IN'] ?? '30d'),
    },
    s3: {
        endpoint: process.env['S3_ENDPOINT'] ?? 'http://localhost:9000',
        accessKey: process.env['S3_ACCESS_KEY'] ?? 'minioadmin',
        secretKey: process.env['S3_SECRET_KEY'] ?? '',
        bucketName: process.env['S3_BUCKET_NAME'] ?? 'karamooziyar',
        region: process.env['S3_REGION'] ?? 'us-east-1',
        useSsl: process.env['S3_USE_SSL'] === 'true',
    },
    upload: {
        maxFileSizeBytes: parseInt(process.env['MAX_FILE_SIZE_BYTES'] ?? '15728640', 10),
    },
    otp: {
        expirySeconds: parseInt(process.env['OTP_EXPIRY_SECONDS'] ?? '120', 10),
        length: parseInt(process.env['OTP_LENGTH'] ?? '6', 10),
        fixedCode: process.env['OTP_FIXED_CODE'],
    },
    throttle: {
        ttl: parseInt(process.env['THROTTLE_TTL'] ?? '60000', 10),
        limit: parseInt(process.env['THROTTLE_LIMIT'] ?? '100', 10),
    },
});
