import { REALTIME_EVENTS } from '@souqna/contracts/constants';
import { listings, orderEvents, orders } from '@souqna/db';
import {
  deadlineStartedBy,
  ListingTransitionError,
  nextListingStatus,
  orderTransition,
  OrderTransitionError,
  payoutHoldDays,
  PostingError,
  postingFor,
  type ListingEffect,
  type ListingEvent,
  type OrderActor,
  type OrderDeadline,
  type OrderEvent,
  type OrderStatus,
} from '@souqna/domain';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { orderConfigById } from './config';
import { personalBalances, postLedger, type Tx } from './ledger';

export type OrderRow = typeof orders.$inferSelect;

export interface TransitionInput {
  orderId: string;
  event: OrderEvent;
  actor: { type: OrderActor; id: string | null };
  reason?: string;
  metadata?: Record<string, unknown>;
  /** A retried request with the same key returns the order without doing anything twice. */
  idempotencyKey?: string;
  /** For resolve_partial. */
  refundMinor?: bigint;
  /** Links the ledger transaction to the payment that caused it. */
  paymentId?: string;
  /** Extra checks on the locked order (e.g. "the deadline really passed"). Throw to refuse. */
  check?: (order: OrderRow) => void;
  /** Extra writes that must commit together with the status change. */
  effects?: (tx: Tx, order: OrderRow) => Promise<void>;
  /** Timers: skip an order another worker is busy with instead of waiting for it. */
  skipLocked?: boolean;
  now?: Date;
}

const LISTING_EVENT: Record<ListingEffect, ListingEvent> = {
  release: 'release',
  release_to_paused: 'release_to_paused',
  mark_sold: 'mark_sold',
};

/** Orders the seller has finished before (for the new-seller payout hold). */
async function sellerCompletedOrders(tx: Tx, sellerId: string, exceptOrderId: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.sellerId, sellerId),
        ne(orders.id, exceptOrderId),
        inArray(orders.status, [
          'completed',
          'resolved_partial',
          'resolved_release',
          'payout_released',
        ]),
      ),
    );
  return row!.n;
}

async function deadlineValue(tx: Tx, order: OrderRow, deadline: OrderDeadline, now: Date) {
  const config = await orderConfigById(tx, order.configId);
  const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);
  switch (deadline) {
    case 'handoverDueAt':
      return hours(config.handoverHours);
    case 'inspectionEndsAt':
      return hours(config.inspectionHours);
    case 'payoutHoldUntil': {
      const done = await sellerCompletedOrders(tx, order.sellerId, order.id);
      return hours(payoutHoldDays(done, config) * 24);
    }
    case 'paymentDueAt':
      return hours(config.paymentHours);
  }
}

/**
 * THE way an order changes status. Inside the caller's DB transaction it:
 *  1. locks the order row (SELECT … FOR UPDATE),
 *  2. checks the move against the state machine in packages/domain/src/order.ts,
 *  3. updates the listing (reserved → active/paused/sold) through the listing state machine,
 *  4. posts the ledger transaction for the move, if it moves money,
 *  5. starts the next deadline, updates the order and writes an order_events row.
 * Returns null only when `skipLocked` is set and another worker holds the order.
 */
export async function applyTransition(tx: Tx, input: TransitionInput): Promise<OrderRow | null> {
  const now = input.now ?? new Date();
  const query = tx.select().from(orders).where(eq(orders.id, input.orderId));
  const [order] = await (input.skipLocked
    ? query.for('update', { skipLocked: true })
    : query.for('update'));
  if (!order) {
    if (input.skipLocked) return null;
    throw new AppError('not_found');
  }

  if (input.idempotencyKey) {
    const [done] = await tx
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.orderId, order.id),
          eq(orderEvents.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (done) return order;
  }

  let to: OrderStatus;
  let listingEffect: ListingEffect | undefined;
  try {
    const rule = orderTransition(order.status, input.event, input.actor.type, order);
    to = rule.to;
    listingEffect = rule.listing;
  } catch (err) {
    if (err instanceof OrderTransitionError) {
      throw new AppError(err.failure === 'forbidden' ? 'forbidden' : 'conflict');
    }
    throw err;
  }
  input.check?.(order);

  if (listingEffect) {
    const [listing] = await tx
      .select({ status: listings.status })
      .from(listings)
      .where(eq(listings.id, order.listingId))
      .for('update');
    try {
      const next = nextListingStatus(listing!.status, LISTING_EVENT[listingEffect], 'system');
      await tx
        .update(listings)
        .set({ status: next, updatedAt: now })
        .where(eq(listings.id, order.listingId));
    } catch (err) {
      // A reserved listing can only be moved by its order, so this means data went wrong.
      if (!(err instanceof ListingTransitionError)) throw err;
      throw new AppError('conflict');
    }
  }

  let entries;
  try {
    const amountMinor =
      input.event === 'release_payout'
        ? (await personalBalances(tx, order.sellerId, order.id)).pendingMinor
        : undefined;
    entries = postingFor(input.event, order, { refundMinor: input.refundMinor, amountMinor });
  } catch (err) {
    if (err instanceof PostingError) throw new AppError('validation_failed');
    throw err;
  }
  if (entries) {
    await postLedger(tx, {
      kind: input.event,
      // One posting per order version: a retry can never move the same money twice.
      idempotencyKey: `order:${order.id}:v${order.version}:${input.event}`,
      entries,
      orderId: order.id,
      paymentId: input.paymentId,
      createdBy: input.actor.id,
    });
  }

  await input.effects?.(tx, order);

  const deadline = deadlineStartedBy(input.event, to);
  const [updated] = await tx
    .update(orders)
    .set({
      status: to,
      version: order.version + 1,
      updatedAt: now,
      ...(deadline ? { [deadline]: await deadlineValue(tx, order, deadline, now) } : {}),
    })
    .where(eq(orders.id, order.id))
    .returning();

  await tx.insert(orderEvents).values({
    orderId: order.id,
    fromStatus: order.status,
    toStatus: to,
    event: input.event,
    actorType: input.actor.type,
    actorId: input.actor.id,
    reason: input.reason,
    metadata: input.metadata ?? {},
    idempotencyKey: input.idempotencyKey,
  });
  return updated!;
}

/** Tells both people's open screens that the order changed. Call after the commit. */
export function notifyOrder(
  ctx: AppContext,
  order: Pick<OrderRow, 'id' | 'status' | 'buyerId' | 'sellerId'>,
) {
  ctx.realtime?.toUsers([order.buyerId, order.sellerId], REALTIME_EVENTS.orderUpdated, {
    orderId: order.id,
    status: order.status,
  });
}

/** applyTransition in its own DB transaction, then a realtime notice. */
export async function transition(
  ctx: AppContext,
  input: TransitionInput,
): Promise<OrderRow | null> {
  const order = await ctx.db.transaction((tx) => applyTransition(tx, input));
  if (order) notifyOrder(ctx, order);
  return order;
}
