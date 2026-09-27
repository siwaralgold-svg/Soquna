import { z } from 'zod';

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

const bool = z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().default(4000),
    /** Comma-separated list of origins allowed to make state-changing requests. */
    APP_ORIGIN: z
      .string()
      .min(1)
      .transform((v) => v.split(',').map((o) => o.trim().replace(/\/$/, ''))),
    TRUST_PROXY: bool,
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    PHONE_HASH_KEY: base64Key,
    OTP_HASH_KEY: base64Key,
    IP_HASH_KEY: base64Key,
    FIELD_ENCRYPTION_KEY_V1: base64Key,
    SESSION_COOKIE_SECURE: bool,
    SMS_PROVIDER: z.enum(['mock', 'whatsapp']).default('mock'),
    STORAGE_DRIVER: z.enum(['s3', 'memory']).default('s3'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().default('souqna-private'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool,
    /** The platform's receiving account, shown to buyers paying by bank transfer (Bankak). */
    PAYMENT_BANK_NAME: z.string().default('Bankak (Bank of Khartoum)'),
    PAYMENT_ACCOUNT_NAME: z.string().default('CHANGE-ME'),
    PAYMENT_ACCOUNT_NUMBER: z.string().default('CHANGE-ME'),
    /** "Test payment" button that pays instantly. Never in production. */
    PAYMENT_MOCK_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Shared secret for a future licensed gateway's signed webhooks. Empty = disabled. */
    PSP_WEBHOOK_SECRET: z.string().default(''),
    S3_CREATE_BUCKET: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'mock is not allowed in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER === 'memory') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'memory is not allowed in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_MOCK_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_MOCK_ENABLED'],
        message: 'test payments are not allowed in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_ACCOUNT_NUMBER === 'CHANGE-ME') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_ACCOUNT_NUMBER'],
        message: 'set the real receiving account',
      });
    }
    if (env.NODE_ENV === 'production' && !env.SESSION_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
  });

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return result.data;
}
