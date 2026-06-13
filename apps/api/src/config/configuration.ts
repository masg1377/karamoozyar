// ms.StringValue — inline copy so we don't need @types/ms at compile time
type MsUnit =
  | 'Years' | 'Year' | 'Yrs' | 'Yr' | 'Y' | 'years' | 'year' | 'yrs' | 'yr' | 'y'
  | 'Weeks' | 'Week' | 'W' | 'weeks' | 'week' | 'w'
  | 'Days' | 'Day' | 'D' | 'days' | 'day' | 'd'
  | 'Hours' | 'Hour' | 'Hrs' | 'Hr' | 'H' | 'hours' | 'hour' | 'hrs' | 'hr' | 'h'
  | 'Minutes' | 'Minute' | 'Mins' | 'Min' | 'M' | 'minutes' | 'minute' | 'mins' | 'min' | 'm'
  | 'Seconds' | 'Second' | 'Secs' | 'Sec' | 's' | 'seconds' | 'second' | 'secs' | 'sec'
  | 'Milliseconds' | 'Millisecond' | 'Msecs' | 'Msec' | 'Ms' | 'milliseconds' | 'millisecond' | 'msecs' | 'msec' | 'ms';
type MsDuration = `${number}` | `${number}${MsUnit}` | `${number} ${MsUnit}`;

export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  frontendUrl: string;
  corsOrigins: string[];
  database: {
    url: string;
  };
  redis: {
    host: string;
    port: number;
    password: string;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: MsDuration;
    refreshExpiresIn: MsDuration;
  };
  s3: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucketName: string;
    region: string;
    useSsl: boolean;
  };
  upload: {
    maxFileSizeBytes: number;
  };
  otp: {
    expirySeconds: number;
    length: number;
    fixedCode?: string;
  };
  throttle: {
    ttl: number;
    limit: number;
  };
  push: {
    publicKey: string;
    privateKey: string;
    subject: string;
  };
}

export default (): AppConfig => ({
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
    accessExpiresIn: (process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m') as MsDuration,
    refreshExpiresIn: (process.env['JWT_REFRESH_EXPIRES_IN'] ?? '90d') as MsDuration,
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
  // Web Push (VAPID, self-hosted) — dev fallback keys; override in production
  push: {
    publicKey:
      process.env['VAPID_PUBLIC_KEY'] ??
      'BPuI5YBkuZCu0ouuzMxIs6RWVYI9zVjK9f4OORHqkni3UoDtS_A2WAsNCwsktcqM1ZTs99eBE5xuG_tNoM8XJvw',
    privateKey: process.env['VAPID_PRIVATE_KEY'] ?? 'vGy6KNxXZg98iwXY6g5ai1_idunMHobxX2UfEdTQtYU',
    subject: process.env['VAPID_SUBJECT'] ?? 'mailto:admin@karamooziyar.ir',
  },
});
