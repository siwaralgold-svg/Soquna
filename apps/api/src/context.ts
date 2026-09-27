import type { Database } from '@souqna/db';
import type { Redis } from 'ioredis';
import type { Config } from './config';
import { FieldCipher, hmac } from './lib/crypto';
import { RateLimiter } from './lib/rate-limiter';
import type { SmsProvider } from './providers/sms';
import type { StorageProvider } from './providers/storage';

export interface AppDeps {
  config: Config;
  db: Database;
  redis: Redis;
  sms: SmsProvider;
  storage: StorageProvider;
}

export interface AppContext extends AppDeps {
  cipher: FieldCipher;
  limiter: RateLimiter;
  hashPhone: (e164: string) => Buffer;
  hashIp: (ip: string) => Buffer;
  otpKey: Buffer;
}

export function createContext(deps: AppDeps): AppContext {
  const key = (b64: string) => Buffer.from(b64, 'base64');
  const phoneKey = key(deps.config.PHONE_HASH_KEY);
  const ipKey = key(deps.config.IP_HASH_KEY);
  return {
    ...deps,
    cipher: new FieldCipher({ 1: key(deps.config.FIELD_ENCRYPTION_KEY_V1) }),
    limiter: new RateLimiter(deps.redis),
    hashPhone: (e164) => hmac(phoneKey, e164),
    hashIp: (ip) => hmac(ipKey, ip),
    otpKey: key(deps.config.OTP_HASH_KEY),
  };
}

export interface AuthState {
  sessionId: string;
  userId: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    auth: AuthState | null;
  }
}
