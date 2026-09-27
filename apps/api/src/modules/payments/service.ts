import type { StaffPayment } from '@souqna/contracts';
import { fraudFlags, media, orders, payments, users } from '@souqna/db';
import { MAX_PAYMENT_SUBMISSIONS } from '@souqna/domain';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { writeAudit } from '../../audit';
import type { AppContext } from '../../context';
import { AppError, isUniqueViolation } from '../../lib/errors';
import { orderFor } from '../orders/service';
import { applyTransition, notifyOrder } from '../orders/transition';
import { paymentProviders } from './providers';

/**
 * The buyer says "I've paid": a bank transfer reference (plus an optional screenshot), or a
 * test payment. Bank transfers wait for finance; the mock provider confirms at once.
 * The same reference can't be used twice: the database refuses it (payments_reference_uq),
 * and the attempt is recorded for the fraud team.
 */
export async function submitPayment(
  ctx: AppContext,
  userId: string,
  orderId: string,
  input: { reference?: string; proofId?: string },
  idempotencyKey: string,
): Promise<void> {
  const { order, role } = await orderFor(ctx.db, orderId, userId);
  if (role !== 'buyer') throw new AppError('forbidden');
  const provider = paymentProviders(ctx.config)[order.paymentMethod];
  if (!provider.prepaid) throw new AppError('conflict');
  const reference = provider.reference(input.reference);

  let updated;
  try {
    updated = await ctx.db.transaction(async (tx) => {
      let paymentId = '';
      const submitted = await applyTransition(tx, {
        orderId: order.id,
        event: 'submit_payment',
        actor: { type: 'buyer', id: userId },
        idempotencyKey,
        metadata: { method: order.paymentMethod },
        effects: async (tx, locked) => {
          const [count] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(payments)
            .where(eq(payments.orderId, locked.id));
          if (count!.n >= MAX_PAYMENT_SUBMISSIONS) {
            throw new AppError('validation_failed', { fields: { reference: 'too_many_attempts' } });
          }
          if (input.proofId) {
            const [proof] = await tx
              .select({ id: media.id })
              .from(media)
              .where(
                and(
                  eq(media.id, input.proofId),
                  eq(media.ownerId, userId),
                  eq(media.kind, 'payment_proof'),
                  eq(media.status, 'ready'),
                ),
              );
            if (!proof)
              throw new AppError('validation_failed', { fields: { proofId: 'not_found' } });
          }
          const [row] = await tx
            .insert(payments)
            .values({
              orderId: locked.id,
              method: locked.paymentMethod,
              amountMinor: locked.totalMinor,
              reference,
              proofMediaId: input.proofId ?? null,
              submittedBy: userId,
            })
            .returning({ id: payments.id });
          paymentId = row!.id;
        },
      });
      if (!provider.confirmsInstantly || !paymentId) return submitted;

      // Mock provider: the "provider" confirms straight away, through the same path finance uses.
      return applyTransition(tx, {
        orderId: order.id,
        event: 'verify_payment',
        actor: { type: 'system', id: null },
        paymentId,
        metadata: { provider: provider.method },
        effects: async (tx) => {
          await tx
            .update(payments)
            .set({ status: 'verified', reviewedAt: new Date() })
            .where(eq(payments.id, paymentId));
        },
      });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'payments_reference_uq')) {
      await ctx.db.insert(fraudFlags).values({
        userId,
        rule: 'duplicate_payment_reference',
        targetType: 'order',
        targetId: order.id,
      });
      throw new AppError('payment_reference_used');
    }
    throw err;
  }
  notifyOrder(ctx, updated!);
}

/** Finance confirms the money arrived (amount and reference match the bank statement). */
export async function verifyPayment(
  ctx: AppContext,
  staffId: string,
  paymentId: string,
  ip: string,
): Promise<void> {
  const order = await ctx.db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update');
    if (!payment) throw new AppError('not_found');
    if (payment.status !== 'submitted') throw new AppError('conflict');
    const updated = await applyTransition(tx, {
      orderId: payment.orderId,
      event: 'verify_payment',
      actor: { type: 'staff', id: staffId },
      paymentId,
      metadata: { paymentId },
      effects: async (tx) => {
        await tx
          .update(payments)
          .set({ status: 'verified', reviewedBy: staffId, reviewedAt: new Date() })
          .where(eq(payments.id, paymentId));
      },
    });
    await writeAudit(
      { db: tx, hashIp: ctx.hashIp },
      {
        actorId: staffId,
        actorRole: 'finance',
        action: 'payment.verify',
        targetType: 'payment',
        targetId: paymentId,
        ip,
        metadata: { orderId: payment.orderId, amountMinor: payment.amountMinor.toString() },
      },
    );
    return updated!;
  });
  notifyOrder(ctx, order);
}

/** Finance can't find the money (or the amount is wrong). The buyer can try again. */
export async function rejectPayment(
  ctx: AppContext,
  staffId: string,
  paymentId: string,
  reason: string,
  ip: string,
): Promise<void> {
  const order = await ctx.db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update');
    if (!payment) throw new AppError('not_found');
    if (payment.status !== 'submitted') throw new AppError('conflict');
    const updated = await applyTransition(tx, {
      orderId: payment.orderId,
      event: 'reject_payment',
      actor: { type: 'staff', id: staffId },
      reason,
      metadata: { paymentId },
      effects: async (tx) => {
        await tx
          .update(payments)
          .set({
            status: 'rejected',
            reviewedBy: staffId,
            reviewedAt: new Date(),
            rejectionReason: reason,
          })
          .where(eq(payments.id, paymentId));
      },
    });
    await writeAudit(
      { db: tx, hashIp: ctx.hashIp },
      {
        actorId: staffId,
        actorRole: 'finance',
        action: 'payment.reject',
        targetType: 'payment',
        targetId: paymentId,
        ip,
        metadata: { orderId: payment.orderId },
      },
    );
    return updated!;
  });
  notifyOrder(ctx, order);
}

/** The finance queue: claims waiting for review, oldest first (or recent decisions). */
export async function listStaffPayments(
  ctx: AppContext,
  status: 'submitted' | 'verified' | 'rejected',
): Promise<StaffPayment[]> {
  const now = Date.now();
  const rows = await ctx.db
    .select({
      payment: payments,
      order: {
        id: orders.id,
        code: orders.publicCode,
        status: orders.status,
        totalMinor: orders.totalMinor,
        buyerId: orders.buyerId,
      },
      buyerName: users.displayName,
      buyerCreatedAt: users.createdAt,
      previousRejections: sql<number>`(select count(*)::int from ${payments} p
        where p.order_id = "payments"."order_id" and p.status = 'rejected' and p.id <> "payments"."id")`,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(users, eq(users.id, orders.buyerId))
    .where(eq(payments.status, status))
    .orderBy(status === 'submitted' ? asc(payments.createdAt) : desc(payments.reviewedAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.payment.id,
    status: r.payment.status,
    method: r.payment.method,
    reference: r.payment.reference,
    amountMinor: r.payment.amountMinor.toString(),
    proofId: r.payment.proofMediaId,
    createdAt: r.payment.createdAt.toISOString(),
    order: {
      id: r.order.id,
      code: r.order.code,
      status: r.order.status,
      totalMinor: r.order.totalMinor.toString(),
    },
    buyer: {
      id: r.order.buyerId,
      displayName: r.buyerName ?? '',
      accountAgeDays: Math.floor((now - r.buyerCreatedAt.getTime()) / 86_400_000),
    },
    previousRejections: r.previousRejections,
  }));
}
