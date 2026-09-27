import { runMigrations } from '../migrate';
import { requireDatabaseUrl } from './env';

await runMigrations(requireDatabaseUrl());
console.log('Migrations applied.');
