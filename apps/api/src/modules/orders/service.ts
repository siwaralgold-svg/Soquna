import { randomInt } from 'node:crypto';
import type {
  CheckoutQuote,
  createOrderInput,
  OrderDetail,
  OrderSummary,
  SellerBalance,
  TimelineActor,
} from '@souqna/contracts';
import type { OrderAction } from '@souqna/contracts/constants';
import {
  conversations,
  listingPhotos,
  listings,
  offers,
  orderEvents,
  orders,
  payments,
  users,
} from '@souqna/db';
import {
  availableOrderEvents,
  checkoutRefusal,
  MAX_PAYMENT_SUBMISSIONS,
  nextListingStatus,
  quoteOrder,
  type DeliveryMethod,
  type OrderEvent,
  type OrderStatus,
} from '@souqna/domain';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppContext } from '../../context';
import { AppError, isUniqueViolation } from '../../lib/errors';
import { enabledPaymentMethods, paymentProviders } from '../payments/providers';
import { currentOrderConfig } from './config';
import { personalBalances, type Executor } from './ledger';
import { applyTransition, notifyOrder, transition, type OrderRow } from './transition';

/** A buyer can't have more than this many orders waiting for payment at once (velocity). */
export const MAX_OPEN_UNPAID_ORDERS = 3;
const UNPAID: OrderStatus[] = [
  'created',
  'awaiting_payment',
  'payment_rejected',
  'payment_submitted',
];

// No 0/O, 1/I/L: codes are read out loud and typed into bank apps.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const newOrderCode = () =>
  `SQ-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`;

const cover = sql<string | null>`(select lp.media_id from ${listingPhotos} lp
  where lp.listing_id = "listings"."id" order by lp.position limit 1)`;

/** The listing and the price the buyer pays: the asking price, or an offer the seller accepted. */
async function priceFor(
  db: Executor,
  buyerId: string,
  listingId: string,
  offerId: string | undefined,
  lock: boolean,
) {
  const query = db
    .select({
      id: listings.id,
      title: listings.title,
      status: listings.status,
      sellerId: listings.sellerId,
      priceMinor: listings.priceMinor,
      coverPhotoId: cover,
      sellerName: users.displayName,
    })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(eq(listings.id, listingId));
  const [listing] = await (lock ? query.for('update', { of: listings }) : query);
  if (!listing || listing.status !== 'active') throw new AppError('listing_unavailable');
  if (listing.sellerId === buyerId) throw new AppError('forbidden');

  let priceMinor = listing.priceMinor;
  if (offerId) {
    const [offer] = await db
      .select({ amountMinor: offers.amountMinor })
      .from(offers)
      .where(
        and(
          eq(offers.id, offerId),
          eq(offers.listingId, listingId),
          eq(offers.buyerId, buyerId),
          eq(offers.status, 'accepted'),
        ),
      );
    if (!offer) throw new AppError('offer_not_allowed');
    priceMinor = offer.amountMinor;
  }
  return { listing, priceMinor };
}

async function buyerFacts(db: Executor, buyerId: string, now: Date) {
  const [row] = await db
    .select({
      createdAt: users.createdAt,
      displayName: users.displayName,
      cityId: users.cityId,
      completed: sql<number>`(select count(*)::int from ${orders} o
        where o.buyer_id = ${buyerId} and o.status in ('completed', 'resolved_partial', 'resolved_release', 'payout_released'))`,
    })
    .from(users)
    .where(eq(users.id, buyerId));
  return {
    profileComplete: Boolean(row!.displayName && row!.cityId),
    accountAgeDays: Math.floor((now.getTime() - row!.createdAt.getTime()) / 86_400_000),
    completedOrders: row!.completed,
  };
}

export async function checkoutQuote(
  ctx: AppContext,
  buyerId: string,
  input: { listingId: string; offerId?: string; deliveryMethod: DeliveryMethod },
): Promise<CheckoutQuote> {
  const now = new Date();
  const { listing, priceMinor } = await priceFor(
    ctx.db,
    buyerId,
    input.listingId,
    input.offerId,
    false,
  );
  const config = await currentOrderConfig(ctx.db, now);
  const quote = quoteOrder(priceMinor, input.deliveryMethod, config);
  const buyer = await buyerFacts(ctx.db, buyerId, now);
  return {
    listing: {
      id: listing.id,
      title: listing.title,
      coverPhotoId: listing.coverPhotoId,
      sellerName: listing.sellerName ?? '',
    },
    offerId: input.offerId ?? null,
    deliveryMethod: input.deliveryMethod,
    itemMinor: quote.itemMinor.toString(),
    deliveryMinor: quote.deliveryMinor.toString(),
    protectionMinor: quote.protectionMinor.toString(),
    totalMinor: quote.totalMinor.toString(),
    paymentMethods: enabledPaymentMethods(ctx.config).map((method) => ({
      method,
      refusal: checkoutRefusal(
        {
          paymentMethod: method,
          deliveryMethod: input.deliveryMethod,
          totalMinor: quote.totalMinor,
          buyerAccountAgeDays: buyer.accountAgeDays,
          buyerCompletedOrders: buyer.completedOrders,
        },
        config,
      ),
    })),
    paymentHours: config.paymentHours,
    inspectionHours: config.inspectionHours,
  };
}

/**
 * Checkout. In one DB transaction: lock the listing, price the order, check the anti-fraud
 * rules, reserve the listing and create the order (plus "waiting for payment" for prepaid
 * methods). The partial unique index on orders.listing_id backs up the lock: a listing can
 * never have two active orders.
 */
export async function createOrder(
  ctx: AppContext,
  buyerId: string,
  input: z.output<typeof createOrderInput>,
): Promise<string> {
  const now = new Date();
  if (!enabledPaymentMethods(ctx.config).includes(input.paymentMethod)) {
    throw new AppError('validation_failed', { fields: { paymentMethod: 'not_available' } });
  }
  const buyer = await buyerFacts(ctx.db, buyerId, now);
  if (!buyer.profileComplete) throw new AppError('forbidden');

  const [open] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.buyerId, buyerId), inArray(orders.status, UNPAID)));
  if (open!.n >= MAX_OPEN_UNPAID_ORDERS) throw new AppError('order_limit_reached');

  const provider = paymentProviders(ctx.config)[input.paymentMethod];
  let order: OrderRow;
  try {
    order = await ctx.db.transaction(async (tx) => {
      const { listing, priceMinor } = await priceFor(
        tx,
        buyerId,
        input.listingId,
        input.offerId,
        true,
      );
      const config = await currentOrderConfig(tx, now);
      const quote = quoteOrder(priceMinor, input.deliveryMethod, config);
      const refusal = checkoutRefusal(
        {
          paymentMethod: input.paymentMethod,
          deliveryMethod: input.deliveryMethod,
          totalMinor: quote.totalMinor,
          buyerAccountAgeDays: buyer.accountAgeDays,
          buyerCompletedOrders: buyer.completedOrders,
        },
        config,
      );
      if (refusal) throw new AppError('order_not_allowed', { fields: { paymentMethod: refusal } });

      await tx
        .update(listings)
        .set({ status: nextListingStatus(listing.status, 'reserve', 'system'), updatedAt: now })
        .where(eq(listings.id, listing.id));

      const [created] = await tx
        .insert(orders)
        .values({
          publicCode: newOrderCode(),
          listingId: listing.id,
          buyerId,
          sellerId: listing.sellerId,
          offerId: input.offerId ?? null,
          status: 'created',
          paymentMethod: input.paymentMethod,
          deliveryMethod: input.deliveryMethod,
          ...quote,
          configId: config.id,
          // Prepaid: pay by then. Cash on delivery: the seller must confirm by then.
          paymentDueAt: new Date(now.getTime() + config.paymentHours * 3_600_000),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx.insert(orderEvents).values({
        orderId: created!.id,
        fromStatus: null,
        toStatus: 'created',
        event: 'create',
        actorType: 'buyer',
        actorId: buyerId,
        metadata: { offerId: input.offerId ?? null },
      });

      if (!provider.prepaid) return created!;
      return (await applyTransition(tx, {
        orderId: created!.id,
        event: 'start_payment',
        actor: { type: 'system', id: null },
        now,
      }))!;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'orders_one_active_per_listing_uq')) {
      throw new AppError('listing_unavailable');
    }
    throw err;
  }
  notifyOrder(ctx, order);
  return order.id;
}

/** The order, if this person is its buyer or seller. Anyone else gets a 404 (no IDOR). */
export async function orderFor(db: Executor, orderId: string, userId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(
      and(eq(orders.id, orderId), or(eq(orders.buyerId, userId), eq(orders.sellerId, userId))),
    );
  if (!order) throw new AppError('not_found');
  return { order, role: order.buyerId === userId ? ('buyer' as const) : ('seller' as const) };
}

const EVENT_TO_ACTION: Partial<Record<OrderEvent, OrderAction>> = {
  cancel_unpaid: 'cancel',
  cancel: 'cancel',
  mark_ready: 'mark_ready',
  confirm_cod: 'confirm_cod',
  confirm_received: 'confirm_received',
};

function viewerOptions(order: OrderRow, role: 'buyer' | 'seller') {
  const events = availableOrderEvents(order.status, role, order);
  const actions = [...new Set(events.flatMap((e) => EVENT_TO_ACTION[e] ?? []))];
  const canPay = events.includes('submit_payment');
  return { actions, canPay, needsAction: canPay || actions.some((a) => a !== 'cancel') };
}

export async function listOrders(
  ctx: AppContext,
  userId: string,
  role: 'buying' | 'selling',
): Promise<OrderSummary[]> {
  const mine = role === 'buying' ? orders.buyerId : orders.sellerId;
  const other = role === 'buying' ? orders.sellerId : orders.buyerId;
  const rows = await ctx.db
    .select({
      order: orders,
      title: listings.title,
      coverPhotoId: cover,
      counterpartName: users.displayName,
    })
    .from(orders)
    .innerJoin(listings, eq(listings.id, orders.listingId))
    .innerJoin(users, eq(users.id, other))
    .where(eq(mine, userId))
    .orderBy(desc(orders.updatedAt))
    .limit(100);
  return rows.map((r) => summary(r.order, role === 'buying' ? 'buyer' : 'seller', r));
}

function summary(
  order: OrderRow,
  role: 'buyer' | 'seller',
  extra: { title: string; coverPhotoId: string | null; counterpartName: string | null },
): OrderSummary {
  return {
    id: order.id,
    code: order.publicCode,
    status: order.status,
    role,
    listing: { id: order.listingId, title: extra.title, coverPhotoId: extra.coverPhotoId },
    counterpart: {
      id: role === 'buyer' ? order.sellerId : order.buyerId,
      displayName: extra.counterpartName ?? '',
    },
    totalMinor: order.totalMinor.toString(),
    needsAction: viewerOptions(order, role).needsAction,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export async function orderDetail(
  ctx: AppContext,
  userId: string,
  orderId: string,
): Promise<OrderDetail> {
  const { order, role } = await orderFor(ctx.db, orderId, userId);
  const [extra] = await ctx.db
    .select({
      title: listings.title,
      listingStatus: listings.status,
      coverPhotoId: cover,
      counterpartName: users.displayName,
    })
    .from(listings)
    .innerJoin(users, eq(users.id, role === 'buyer' ? order.sellerId : order.buyerId))
    .where(eq(listings.id, order.listingId));

  const events = await ctx.db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, order.id))
    .orderBy(asc(orderEvents.id));
  const paymentRows = await ctx.db
    .select()
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .orderBy(desc(payments.createdAt));
  const [conversation] = await ctx.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(eq(conversations.listingId, order.listingId), eq(conversations.buyerId, order.buyerId)),
    );
  const refunds =
    role === 'buyer' ? (await personalBalances(ctx.db, order.buyerId, order.id)).refundsMinor : 0n;

  const { actions, canPay, needsAction } = viewerOptions(order, role);
  const latest = role === 'buyer' ? paymentRows[0] : undefined;
  const provider = paymentProviders(ctx.config)[order.paymentMethod];
  const instructions = role === 'buyer' && canPay ? provider.instructions(order) : null;

  const by = (e: typeof orderEvents.$inferSelect): TimelineActor => {
    if (e.actorId === userId) return 'you';
    if (e.actorType === 'buyer' || e.actorType === 'seller' || e.actorType === 'courier') {
      return e.actorType;
    }
    return 'souqna';
  };

  return {
    ...summary(order, role, extra!),
    needsAction,
    paymentMethod: order.paymentMethod,
    deliveryMethod: order.deliveryMethod,
    amounts: {
      itemMinor: order.itemMinor.toString(),
      deliveryMinor: order.deliveryMinor.toString(),
      protectionMinor: order.protectionMinor.toString(),
      totalMinor: order.totalMinor.toString(),
    },
    deadlines: {
      paymentDueAt: order.paymentDueAt?.toISOString() ?? null,
      handoverDueAt: order.handoverDueAt?.toISOString() ?? null,
      inspectionEndsAt: order.inspectionEndsAt?.toISOString() ?? null,
      payoutHoldUntil: order.payoutHoldUntil?.toISOString() ?? null,
    },
    actions,
    canPay,
    payment: {
      instructions: instructions && {
        ...instructions,
        amountMinor: instructions.amountMinor.toString(),
      },
      latest: latest
        ? {
            status: latest.status,
            reference: latest.reference,
            rejectionReason: latest.rejectionReason,
            createdAt: latest.createdAt.toISOString(),
          }
        : null,
      submissionsLeft: Math.max(0, MAX_PAYMENT_SUBMISSIONS - paymentRows.length),
    },
    refundMinor: refunds > 0n ? refunds.toString() : null,
    timeline: events.map((e) => ({
      id: e.id.toString(),
      status: e.toStatus,
      event: e.event,
      by: by(e),
      // Only reasons meant for the people in the order (rejections, cancellations).
      reason: e.reason,
      at: e.createdAt.toISOString(),
    })),
    conversationId: conversation?.id ?? null,
    listingStatus: extra!.listingStatus,
  };
}

const ACTION_EVENTS: Record<OrderAction, (status: OrderStatus) => OrderEvent> = {
  cancel: (status) =>
    ['created', 'awaiting_payment', 'payment_rejected'].includes(status)
      ? 'cancel_unpaid'
      : 'cancel',
  mark_ready: () => 'mark_ready',
  confirm_cod: () => 'confirm_cod',
  confirm_received: () => 'confirm_received',
};

/** A buyer or seller presses a button on the order page. */
export async function orderAction(
  ctx: AppContext,
  userId: string,
  orderId: string,
  input: { action: OrderAction; reason?: string },
  idempotencyKey: string,
): Promise<void> {
  const { order, role } = await orderFor(ctx.db, orderId, userId);
  await transition(ctx, {
    orderId: order.id,
    event: ACTION_EVENTS[input.action](order.status),
    actor: { type: role, id: userId },
    reason: input.reason || undefined,
    idempotencyKey,
  });
}

export async function balanceFor(ctx: AppContext, userId: string): Promise<SellerBalance> {
  const b = await personalBalances(ctx.db, userId);
  return {
    pendingMinor: b.pendingMinor.toString(),
    availableMinor: b.availableMinor.toString(),
    refundsMinor: b.refundsMinor.toString(),
  };
}
