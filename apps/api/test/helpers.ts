import { randomBytes, randomInt } from 'node:crypto';
import { Writable } from 'node:stream';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@souqna/contracts';
import { createTestDatabase, type TestDatabase } from '@souqna/db/testing';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { Redis } from 'ioredis';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { MockSmsProvider } from '../src/providers/sms';
import { MemoryStorage } from '../src/providers/storage';

export const APP_ORIGIN = 'http://localhost:3000';

export interface TestApp {
  app: FastifyInstance;
  db: TestDatabase;
  redis: Redis;
  sms: MockSmsProvider;
  storage: MemoryStorage;
  logs: string[];
  close: () => Promise<void>;
}

const key = () => randomBytes(32).toString('base64');

export async function createTestApp(): Promise<TestApp> {
  const db = await createTestDatabase();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('Set REDIS_URL to run API tests.');
  // A unique prefix per file keeps rate-limit counters from leaking between test files.
  const redis = new Redis(redisUrl, { keyPrefix: `test:${randomBytes(4).toString('hex')}:` });

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    APP_ORIGIN,
    TRUST_PROXY: 'false',
    DATABASE_URL: db.url,
    REDIS_URL: redisUrl,
    PHONE_HASH_KEY: key(),
    OTP_HASH_KEY: key(),
    IP_HASH_KEY: key(),
    FIELD_ENCRYPTION_KEY_V1: key(),
    SESSION_COOKIE_SECURE: 'true',
    SMS_PROVIDER: 'mock',
    STORAGE_DRIVER: 'memory',
  });

  const logs: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, done) {
      logs.push(chunk.toString());
      done();
    },
  });

  const sms = new MockSmsProvider();
  const storage = new MemoryStorage();
  const app = await buildApp({ config, db: db.db, redis, sms, storage }, { logStream });
  await app.ready();

  return {
    app,
    db,
    redis,
    sms,
    storage,
    logs,
    close: async () => {
      await app.close();
      await redis.quit();
      await db.drop();
    },
  };
}

export function randomPhone(): string {
  return `09${randomInt(10_000_000, 99_999_999)}`;
}

export function toE164(local: string): string {
  return `+249${local.slice(1)}`;
}

export function randomIp(): string {
  return `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;
}

/** Headers a browser on our own origin would send for a state-changing request. */
export const writeHeaders = { [CSRF_HEADER]: CSRF_HEADER_VALUE, origin: APP_ORIGIN };

export function sessionCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === 'sq_sid');
  if (!cookie) throw new Error('no session cookie in response');
  return `sq_sid=${cookie.value}`;
}

/** Simulates the resend cooldown and per-number limits having expired. */
export async function resetPhoneLimits(t: TestApp, phone: string): Promise<void> {
  const hash = t.app.ctx.hashPhone(toE164(phone)).toString('hex');
  await t.redis.del(`cd:otp:${hash}`, `rl:otp:phone:10m:${hash}`, `rl:otp:phone:1d:${hash}`);
}

export async function requestCode(
  t: TestApp,
  phone: string,
  ip = randomIp(),
): Promise<{ challengeId: string; code: string }> {
  await resetPhoneLimits(t, phone);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/otp/request',
    headers: writeHeaders,
    payload: { phone },
    remoteAddress: ip,
  });
  if (res.statusCode !== 201) throw new Error(`OTP request failed: ${res.statusCode} ${res.body}`);
  return { challengeId: res.json().challengeId, code: t.sms.lastCodeFor(toE164(phone))! };
}

/** Logs in with a fresh (or given) phone number and returns the session cookie. */
export async function login(
  t: TestApp,
  phone = randomPhone(),
  extra: Partial<InjectOptions> = {},
): Promise<{ cookie: string; phone: string }> {
  const ip = randomIp();
  const { challengeId, code } = await requestCode(t, phone, ip);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/otp/verify',
    headers: { ...writeHeaders, ...(extra.headers as Record<string, string>) },
    payload: { challengeId, code },
    remoteAddress: ip,
  });
  if (res.statusCode !== 200) throw new Error(`OTP verify failed: ${res.statusCode} ${res.body}`);
  return { cookie: sessionCookie(res), phone };
}
