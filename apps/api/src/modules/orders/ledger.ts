import { ledgerAccounts, ledgerEntries, ledgerTransactions, type Database } from '@souqna/db';
import {
  assertBalanced,
  displayBalance,
  type LedgerAccount,
  type LedgerEntry,
} from '@souqna/domain';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Tx;

/** Finds (or opens) the account row for a code and owner. */
async function accountId(tx: Tx, account: LedgerAccount, ownerId: string | null): Promise<string> {
  await tx.insert(ledgerAccounts).values({ code: account, ownerId }).onConflictDoNothing();
  const [row] = await tx
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.code, account),
        ownerId ? eq(ledgerAccounts.ownerId, ownerId) : isNull(ledgerAccounts.ownerId),
      ),
    );
  return row!.id;
}

/**
 * Writes one balanced ledger transaction. Checked twice: here (assertBalanced) and by the
 * database at commit (deferred trigger in migration 0006). The idempotency key is unique,
 * so the same money movement can never be posted twice.
 */
export async function postLedger(
  tx: Tx,
  input: {
    kind: string;
    idempotencyKey: string;
    entries: LedgerEntry[];
    orderId?: string;
    paymentId?: string;
    createdBy?: string | null;
  },
): Promise<string> {
  assertBalanced(input.entries);
  const [row] = await tx
    .insert(ledgerTransactions)
    .values({
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      orderId: input.orderId,
      paymentId: input.paymentId,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: ledgerTransactions.id });
  for (const entry of input.entries) {
    await tx.insert(ledgerEntries).values({
      transactionId: row!.id,
      accountId: await accountId(tx, entry.account, entry.ownerId),
      amountMinor: entry.amountMinor,
    });
  }
  return row!.id;
}

/** Raw SUM of entries on one person's accounts, by account code. */
async function sums(
  db: Executor,
  ownerId: string,
  codes: LedgerAccount[],
  orderId?: string,
): Promise<Map<LedgerAccount, bigint>> {
  const rows = await db
    .select({
      code: ledgerAccounts.code,
      sum: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)::text`,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .where(
      and(
        eq(ledgerAccounts.ownerId, ownerId),
        inArray(ledgerAccounts.code, codes),
        orderId ? eq(ledgerTransactions.orderId, orderId) : undefined,
      ),
    )
    .groupBy(ledgerAccounts.code);
  return new Map(rows.map((r) => [r.code, BigInt(r.sum)]));
}

/** Balances as people understand them (positive = money for this person). */
export async function personalBalances(db: Executor, ownerId: string, orderId?: string) {
  const codes: LedgerAccount[] = ['seller_pending', 'seller_balance', 'refunds'];
  const raw = await sums(db, ownerId, codes, orderId);
  const get = (code: LedgerAccount) => displayBalance(code, raw.get(code) ?? 0n);
  return {
    pendingMinor: get('seller_pending'),
    availableMinor: get('seller_balance'),
    refundsMinor: get('refunds'),
  };
}

/** Platform-wide balance of one account (for checks and tests). */
export async function platformBalance(db: Executor, account: LedgerAccount): Promise<bigint> {
  const [row] = await db
    .select({ sum: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)::text` })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(eq(ledgerAccounts.code, account));
  return BigInt(row!.sum);
}
