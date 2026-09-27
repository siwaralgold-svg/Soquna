import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { runMigrations } from './migrate';
import { seed } from './seed';
import { createDb, type DbHandle } from './index';

export interface TestDatabase extends DbHandle {
  url: string;
  drop: () => Promise<void>;
}

/**
 * Creates a fresh, migrated, seeded database for one test file and drops it afterwards.
 * Append-only tables can't be truncated, so tests get their own database instead.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) to run DB tests.');

  const name = `souqna_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);

  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());

  const handle = createDb(url.toString(), { max: 5 });
  await seed(handle.db);

  return {
    ...handle,
    url: url.toString(),
    drop: async () => {
      await handle.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 5 });
    },
  };
}
