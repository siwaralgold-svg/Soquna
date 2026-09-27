import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from '@souqna/db';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { buildApp } from './app';
import { loadConfig } from './config';
import { startOrderTimers } from './jobs/timers';
import { MockSmsProvider, WhatsAppOtpProvider } from './providers/sms';
import { createStorage } from './providers/storage';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
const storage = await createStorage(config);
const sms =
  config.SMS_PROVIDER === 'mock'
    ? new MockSmsProvider(pino({ level: config.LOG_LEVEL, name: 'sms' }))
    : new WhatsAppOtpProvider();

const app = await buildApp({ config, db: db.db, redis, storage, sms });

const stopTimers = startOrderTimers(app.ctx, app.log);

const shutdown = async () => {
  stopTimers();
  await app.close();
  await db.close();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.API_HOST, port: config.API_PORT });
