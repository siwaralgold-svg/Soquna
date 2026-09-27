import { orderConfigs } from '@souqna/db';
import type { OrderConfig } from '@souqna/domain';
import { desc, eq, lte } from 'drizzle-orm';
import type { Executor } from './ledger';

type ConfigRow = typeof orderConfigs.$inferSelect;

const toConfig = (row: ConfigRow): OrderConfig & { id: string } => ({
  id: row.id,
  protectionFixedMinor: row.protectionFixedMinor,
  protectionPctBps: row.protectionPctBps,
  protectionCapMinor: row.protectionCapMinor,
  courierFeeMinor: row.courierFeeMinor,
  codMaxMinor: row.codMaxMinor,
  newBuyerMaxMinor: row.newBuyerMaxMinor,
  newAccountDays: row.newAccountDays,
  paymentHours: row.paymentHours,
  handoverHours: row.handoverHours,
  inspectionHours: row.inspectionHours,
  newSellerHoldDays: row.newSellerHoldDays,
  newSellerOrders: row.newSellerOrders,
});

/** The settings in effect now: the newest row whose effective_from has passed. */
export async function currentOrderConfig(db: Executor, now = new Date()) {
  const [row] = await db
    .select()
    .from(orderConfigs)
    .where(lte(orderConfigs.effectiveFrom, now))
    .orderBy(desc(orderConfigs.effectiveFrom))
    .limit(1);
  if (!row) throw new Error('No order_configs row: run the seed (pnpm db:seed).');
  return toConfig(row);
}

/** The settings an existing order was priced with. */
export async function orderConfigById(db: Executor, id: string) {
  const [row] = await db.select().from(orderConfigs).where(eq(orderConfigs.id, id));
  return toConfig(row!);
}
