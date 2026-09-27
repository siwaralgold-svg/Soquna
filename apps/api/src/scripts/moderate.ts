/* eslint-disable no-console -- command-line tool */
// Moderation from the command line, until the admin screens with 2FA arrive in Phase 6.
// Only people with server access can run it. Every decision is written to the audit log.
//
//   pnpm moderate list
//   pnpm moderate approve <listing-id>
//   pnpm moderate reject  <listing-id> "reason shown to the seller"
//   pnpm moderate remove  <listing-id> "reason shown to the seller"
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from '@souqna/db';
import {
  listPendingListings,
  moderateListing,
  type ModerationAction,
} from '../modules/listings/moderation';

const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const [command, listingId, ...noteParts] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const handle = createDb(url, { max: 1 });
try {
  if (command === 'list' || !command) {
    const pending = await listPendingListings(handle.db);
    if (pending.length === 0) console.log('Nothing waiting for review.');
    for (const p of pending) {
      console.log(
        `\n${p.id}  (${p.openReports} open reports, updated ${p.updatedAt.toISOString()})`,
      );
      console.log(`  Title: ${p.title}`);
      console.log(`  Seller: ${p.sellerName ?? '-'}`);
      console.log(`  ${p.description.slice(0, 300).replace(/\n/g, ' ')}`);
    }
  } else if (['approve', 'reject', 'remove'].includes(command) && listingId) {
    await moderateListing(handle.db, {
      listingId,
      action: command as ModerationAction,
      note: noteParts.join(' '),
      moderatorId: null,
      via: 'cli',
    });
    console.log(`Done: ${command} ${listingId}`);
  } else {
    console.error(
      'Usage: pnpm moderate list | approve <id> | reject <id> "reason" | remove <id> "reason"',
    );
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await handle.close();
}
