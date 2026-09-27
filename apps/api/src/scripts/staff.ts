/* eslint-disable no-console -- command-line tool */
// Staff roles and 2FA, from the command line. Only people with server access can run it,
// which is what keeps "who is an admin" out of reach of the web app. Every change is audited.
//
//   pnpm staff grant 0912345678 finance     give a role (and set up 2FA the first time)
//   pnpm staff revoke 0912345678 finance    take a role away
//   pnpm staff reset-2fa 0912345678         new 2FA secret (lost phone)
//   pnpm staff list                         who has which role
//   pnpm staff code 0912345678              DEVELOPMENT ONLY: print the current 2FA code
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, staffMfa, userRoles, users } from '@souqna/db';
import { normalizeSudanPhone } from '@souqna/domain';
import { and, eq } from 'drizzle-orm';
import { writeAudit } from '../audit';
import { loadConfig } from '../config';
import { FieldCipher, hmac } from '../lib/crypto';
import { otpauthUri, totpCode, totpStep } from '../lib/totp';
import { enrolTotp, STAFF_ROLES, type StaffRole } from '../modules/staff/mfa';

const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config = loadConfig();
const key = (b64: string) => Buffer.from(b64, 'base64');
const cipher = new FieldCipher({ 1: key(config.FIELD_ENCRYPTION_KEY_V1) });
const handle = createDb(config.DATABASE_URL, { max: 1 });
const { db } = handle;

const [command, phoneArg, roleArg] = process.argv.slice(2);

async function findUser(phone: string | undefined) {
  const e164 = phone ? normalizeSudanPhone(phone) : null;
  if (!e164) throw new Error('Give a Sudanese mobile number, e.g. 0912345678.');
  const [user] = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.phoneHash, hmac(key(config.PHONE_HASH_KEY), e164)));
  if (!user)
    throw new Error('No account with that number. They must log in to the app once first.');
  return user;
}

function printSecret(secret: string, label: string) {
  console.log(
    '\nSet up 2FA in an authenticator app (Google Authenticator, Microsoft Authenticator…):',
  );
  console.log('  Add account → Enter a setup key');
  console.log(`  Account name: ${label}`);
  console.log(`  Key: ${secret}`);
  console.log(`  Type: Time based`);
  console.log(`\nOr turn this link into a QR code: ${otpauthUri(secret, label)}`);
  console.log('\nShare the key privately (never in chat or email). It is shown only now.');
}

try {
  if (command === 'list') {
    const rows = await db
      .select({ role: userRoles.role, name: users.displayName, userId: users.id })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId));
    if (rows.length === 0) console.log('No staff yet.');
    for (const r of rows) console.log(`${r.role.padEnd(10)} ${r.name ?? '-'} (${r.userId})`);
  } else if (command === 'grant' || command === 'revoke') {
    if (!STAFF_ROLES.includes(roleArg as StaffRole)) {
      throw new Error(`Role must be one of: ${STAFF_ROLES.join(', ')}`);
    }
    const role = roleArg as StaffRole;
    const user = await findUser(phoneArg);
    if (command === 'grant') {
      await db.insert(userRoles).values({ userId: user.id, role }).onConflictDoNothing();
      const [mfa] = await db.select().from(staffMfa).where(eq(staffMfa.userId, user.id));
      if (!mfa && role !== 'courier') {
        printSecret(await enrolTotp({ db, cipher }, user.id), user.displayName ?? user.id);
      }
    } else {
      await db
        .delete(userRoles)
        .where(and(eq(userRoles.userId, user.id), eq(userRoles.role, role)));
    }
    await writeAudit(
      { db },
      {
        actorId: null,
        actorRole: 'system',
        action: `staff.${command}`,
        targetType: 'user',
        targetId: user.id,
        metadata: { role, via: 'cli' },
      },
    );
    console.log(`Done: ${command} ${role} for ${user.displayName ?? user.id}`);
  } else if (command === 'reset-2fa') {
    const user = await findUser(phoneArg);
    printSecret(await enrolTotp({ db, cipher }, user.id), user.displayName ?? user.id);
    await writeAudit(
      { db },
      {
        actorId: null,
        actorRole: 'system',
        action: 'staff.reset_2fa',
        targetType: 'user',
        targetId: user.id,
        metadata: { via: 'cli' },
      },
    );
  } else if (command === 'code') {
    if (config.NODE_ENV === 'production') throw new Error('Not available in production.');
    const user = await findUser(phoneArg);
    const [mfa] = await db.select().from(staffMfa).where(eq(staffMfa.userId, user.id));
    if (!mfa) throw new Error('This person has no 2FA set up.');
    console.log(totpCode(cipher.decrypt(mfa.secretEnc), totpStep(Date.now())));
  } else {
    console.error(
      'Usage: pnpm staff list | grant <phone> <role> | revoke <phone> <role> | reset-2fa <phone> | code <phone>',
    );
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await handle.close();
}
