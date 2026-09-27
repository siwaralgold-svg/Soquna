import { createDb } from '../index';
import { seed } from '../seed';
import { requireDatabaseUrl } from './env';

const handle = createDb(requireDatabaseUrl(), { max: 1 });
try {
  await seed(handle.db);
  console.log('Seed data applied.');
} finally {
  await handle.close();
}
