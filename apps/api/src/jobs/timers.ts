import { orders } from '@souqna/db';
import { ORDER_TIMERS } from '@souqna/domain';
import { and, asc, inArray, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context';
import { AppError } from '../lib/errors';
import { transition } from '../modules/orders/transition';

/** How often the API checks order deadlines. */
export const TIMER_INTERVAL_MS = 60_000;
const BATCH = 100;

/**
 * Acts on order deadlines that have passed: unpaid orders are cancelled, hand-overs that
 * didn't happen expire (refund), inspection windows auto-complete, and new-seller holds
 * end. Each order goes through the normal transition(), which locks it with
 * FOR UPDATE SKIP LOCKED and re-checks the status and deadline, so running this twice, or
 * on several API servers at once, can never act on an order twice.
 */
export async function runOrderTimers(
  ctx: AppContext,
  log?: Pick<FastifyBaseLogger, 'error'>,
  now = new Date(),
): Promise<number> {
  let changed = 0;
  for (const timer of ORDER_TIMERS) {
    const column = orders[timer.deadline];
    const due = await ctx.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(inArray(orders.status, [...timer.statuses]), lte(column, now)))
      .orderBy(asc(column))
      .limit(BATCH);

    for (const { id } of due) {
      try {
        const done = await transition(ctx, {
          orderId: id,
          event: timer.event,
          actor: { type: 'system', id: null },
          reason: 'deadline',
          skipLocked: true,
          now,
          check: (order) => {
            const deadline = order[timer.deadline];
            if (!deadline || deadline > now) throw new AppError('conflict');
          },
        });
        if (done) changed += 1;
      } catch (err) {
        // Already moved on by someone else (conflict) is normal; anything else is logged
        // and retried on the next run, without stopping the other orders.
        if (!(err instanceof AppError && err.code === 'conflict')) {
          log?.error({ err, orderId: id, event: timer.event }, 'order timer failed');
        }
      }
    }
  }
  return changed;
}

/** Starts the timer loop; returns a function that stops it. */
export function startOrderTimers(ctx: AppContext, log: Pick<FastifyBaseLogger, 'error'>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runOrderTimers(ctx, log);
    } catch (err) {
      log.error({ err }, 'order timers run failed');
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => void tick(), TIMER_INTERVAL_MS);
  void tick();
  return () => clearInterval(handle);
}
