import { describe, expect, it } from 'vitest';
import {
  availableOrderEvents,
  deadlineStartedBy,
  DELIVERY_METHODS,
  isMoneyHeld,
  normalizePaymentReference,
  ORDER_ACTORS,
  ORDER_EVENTS,
  ORDER_STATUSES,
  ORDER_TIMERS,
  ORDER_TRANSITIONS,
  orderTransition,
  OrderTransitionError,
  PAYMENT_METHODS,
  type OrderActor,
  type OrderEvent,
  type OrderFacts,
  type OrderStatus,
} from './order';

/**
 * The transition table from docs/plan/phase-0.md §3a, written out independently of the
 * implementation. Every (from, event) pair here must be possible for some actor and order;
 * every pair NOT here must be refused for everyone.
 */
const EXPECTED: Array<[OrderStatus, OrderEvent, OrderStatus]> = [
  ['created', 'start_payment', 'awaiting_payment'],
  ['created', 'confirm_cod', 'ready_for_pickup'],
  ['created', 'cancel_unpaid', 'cancelled'],
  ['awaiting_payment', 'cancel_unpaid', 'cancelled'],
  ['payment_rejected', 'cancel_unpaid', 'cancelled'],
  ['awaiting_payment', 'submit_payment', 'payment_submitted'],
  ['payment_rejected', 'submit_payment', 'payment_submitted'],
  ['payment_submitted', 'verify_payment', 'funds_held'],
  ['payment_submitted', 'reject_payment', 'payment_rejected'],
  ['funds_held', 'mark_ready', 'ready_for_pickup'],
  ['funds_held', 'cancel', 'cancelled'],
  ['ready_for_pickup', 'cancel', 'cancelled'],
  ['funds_held', 'expire', 'expired'],
  ['ready_for_pickup', 'expire', 'expired'],
  ['ready_for_pickup', 'pick_up', 'picked_up'],
  ['ready_for_pickup', 'ship', 'out_for_delivery'],
  ['ready_for_pickup', 'hand_over', 'delivered'],
  ['picked_up', 'set_off', 'out_for_delivery'],
  ['out_for_delivery', 'deliver', 'delivered'],
  ['picked_up', 'fail_delivery', 'delivery_failed'],
  ['out_for_delivery', 'fail_delivery', 'delivery_failed'],
  ['delivery_failed', 'retry_delivery', 'out_for_delivery'],
  ['delivery_failed', 'return_to_seller', 'cancelled'],
  ['delivered', 'confirm_received', 'completed'],
  ['delivered', 'auto_complete', 'completed'],
  ['delivered', 'dispute', 'disputed'],
  ['disputed', 'resolve_refund', 'resolved_refund'],
  ['disputed', 'resolve_partial', 'resolved_partial'],
  ['disputed', 'resolve_release', 'resolved_release'],
  ['disputed', 'withdraw_dispute', 'resolved_release'],
  ['completed', 'release_payout', 'payout_released'],
  ['resolved_partial', 'release_payout', 'payout_released'],
  ['resolved_release', 'release_payout', 'payout_released'],
];

const ALL_FACTS: OrderFacts[] = PAYMENT_METHODS.flatMap((paymentMethod) =>
  DELIVERY_METHODS.map((deliveryMethod) => ({ paymentMethod, deliveryMethod })),
);

function outcomes(from: OrderStatus, event: OrderEvent) {
  const ok: Array<{ actor: OrderActor; facts: OrderFacts; to: OrderStatus }> = [];
  for (const actor of ORDER_ACTORS) {
    for (const facts of ALL_FACTS) {
      try {
        ok.push({ actor, facts, to: orderTransition(from, event, actor, facts).to });
      } catch (err) {
        expect(err).toBeInstanceOf(OrderTransitionError);
      }
    }
  }
  return ok;
}

const bank: OrderFacts = { paymentMethod: 'bank_transfer', deliveryMethod: 'courier' };
const cod: OrderFacts = { paymentMethod: 'cod', deliveryMethod: 'courier' };
const meetup: OrderFacts = { paymentMethod: 'bank_transfer', deliveryMethod: 'meetup' };
const sellerArranged: OrderFacts = { paymentMethod: 'mock', deliveryMethod: 'seller_arranged' };

describe('order state machine', () => {
  it('allows exactly the transitions in the plan, and refuses every other pair', () => {
    for (const from of ORDER_STATUSES) {
      for (const event of ORDER_EVENTS) {
        const expected = EXPECTED.find(([f, e]) => f === from && e === event);
        const ok = outcomes(from, event);
        if (expected) {
          expect(ok.length, `${from} --${event}-->`).toBeGreaterThan(0);
          for (const o of ok) expect(o.to).toBe(expected[2]);
        } else {
          expect(ok, `${from} --${event}--> must be refused`).toEqual([]);
        }
      }
    }
    // And the table has nothing beyond the plan.
    const rows = ORDER_TRANSITIONS.flatMap((t) => t.from.map((f) => [f, t.event]));
    expect(rows).toHaveLength(EXPECTED.length);
  });

  it.each<[OrderStatus, OrderEvent, OrderActor[]]>([
    ['created', 'start_payment', ['buyer', 'system']],
    ['created', 'cancel_unpaid', ['buyer', 'system']],
    ['awaiting_payment', 'submit_payment', ['buyer']],
    ['payment_submitted', 'verify_payment', ['staff', 'system']],
    ['payment_submitted', 'reject_payment', ['staff']],
    ['funds_held', 'mark_ready', ['seller']],
    ['funds_held', 'cancel', ['buyer', 'seller', 'staff']],
    ['funds_held', 'expire', ['system']],
    ['delivered', 'confirm_received', ['buyer']],
    ['delivered', 'auto_complete', ['system']],
    ['delivered', 'dispute', ['buyer']],
    ['disputed', 'resolve_refund', ['staff']],
    ['disputed', 'withdraw_dispute', ['buyer']],
    ['delivery_failed', 'retry_delivery', ['courier', 'staff']],
    ['delivery_failed', 'return_to_seller', ['staff']],
    ['completed', 'release_payout', ['system']],
  ])('%s --%s--> only by %j', (from, event, actors) => {
    const facts = event === 'confirm_cod' ? cod : bank;
    for (const actor of ORDER_ACTORS) {
      if (actors.includes(actor)) {
        expect(() => orderTransition(from, event, actor, facts)).not.toThrow();
      } else {
        expect(() => orderTransition(from, event, actor, facts)).toThrowError(
          expect.objectContaining({ failure: 'forbidden' }),
        );
      }
    }
  });

  it('keeps cash on delivery off the prepaid path and vice versa', () => {
    expect(() => orderTransition('created', 'start_payment', 'buyer', cod)).toThrowError(
      expect.objectContaining({ failure: 'invalid_transition' }),
    );
    expect(() => orderTransition('created', 'confirm_cod', 'seller', bank)).toThrow();
    expect(orderTransition('created', 'confirm_cod', 'seller', cod).to).toBe('ready_for_pickup');
    expect(() =>
      orderTransition('awaiting_payment', 'submit_payment', 'buyer', { ...cod }),
    ).toThrow();
    // COD needs a courier.
    expect(() =>
      orderTransition('created', 'confirm_cod', 'seller', {
        paymentMethod: 'cod',
        deliveryMethod: 'meetup',
      }),
    ).toThrow();
  });

  it('matches the hand-over step to the delivery method', () => {
    expect(orderTransition('ready_for_pickup', 'pick_up', 'courier', bank).to).toBe('picked_up');
    expect(() => orderTransition('ready_for_pickup', 'pick_up', 'courier', meetup)).toThrow();
    expect(orderTransition('ready_for_pickup', 'hand_over', 'seller', meetup).to).toBe('delivered');
    expect(() => orderTransition('ready_for_pickup', 'hand_over', 'seller', bank)).toThrow();
    expect(orderTransition('ready_for_pickup', 'ship', 'seller', sellerArranged).to).toBe(
      'out_for_delivery',
    );
    expect(() => orderTransition('ready_for_pickup', 'ship', 'seller', bank)).toThrow();
    expect(() => orderTransition('picked_up', 'set_off', 'courier', sellerArranged)).toThrow();
    expect(() =>
      orderTransition('out_for_delivery', 'fail_delivery', 'courier', sellerArranged),
    ).toThrow();
  });

  it('lets the courier deliver courier orders and the buyer confirm seller-arranged ones', () => {
    expect(orderTransition('out_for_delivery', 'deliver', 'courier', bank).to).toBe('delivered');
    expect(() => orderTransition('out_for_delivery', 'deliver', 'buyer', bank)).toThrow();
    expect(orderTransition('out_for_delivery', 'deliver', 'buyer', sellerArranged).to).toBe(
      'delivered',
    );
    expect(() =>
      orderTransition('out_for_delivery', 'deliver', 'courier', sellerArranged),
    ).toThrow();
    expect(() => orderTransition('out_for_delivery', 'deliver', 'seller', bank)).toThrowError(
      expect.objectContaining({ failure: 'forbidden' }),
    );
  });

  it('describes the error', () => {
    const err = new OrderTransitionError('created', 'deliver', 'buyer', 'invalid_transition');
    expect(err.message).toBe('Order cannot deliver from created as buyer (invalid_transition)');
  });

  it('touches the listing only where the plan says', () => {
    const effect = (event: OrderEvent) => ORDER_TRANSITIONS.find((t) => t.event === event)!.listing;
    expect(effect('cancel_unpaid')).toBe('release');
    expect(effect('cancel')).toBe('release');
    expect(effect('return_to_seller')).toBe('release');
    expect(effect('expire')).toBe('release_to_paused');
    expect(effect('resolve_refund')).toBe('release_to_paused');
    for (const e of [
      'confirm_received',
      'auto_complete',
      'resolve_partial',
      'resolve_release',
      'withdraw_dispute',
    ] as const) {
      expect(effect(e)).toBe('mark_sold');
    }
    expect(effect('verify_payment')).toBeUndefined();
  });
});

describe('availableOrderEvents', () => {
  it('lists what each person can do now', () => {
    expect(availableOrderEvents('created', 'buyer', bank)).toEqual([
      'start_payment',
      'cancel_unpaid',
    ]);
    expect(availableOrderEvents('created', 'seller', cod)).toEqual(['confirm_cod']);
    expect(availableOrderEvents('created', 'seller', bank)).toEqual([]);
    expect(availableOrderEvents('funds_held', 'seller', bank)).toEqual(['mark_ready', 'cancel']);
    expect(availableOrderEvents('delivered', 'buyer', meetup)).toEqual([
      'confirm_received',
      'dispute',
    ]);
    expect(availableOrderEvents('payment_submitted', 'buyer', bank)).toEqual([]);
  });
});

describe('money held and deadlines', () => {
  it('knows when the buyer’s money is in escrow', () => {
    expect(isMoneyHeld('awaiting_payment', 'bank_transfer')).toBe(false);
    expect(isMoneyHeld('payment_submitted', 'bank_transfer')).toBe(false);
    expect(isMoneyHeld('funds_held', 'bank_transfer')).toBe(true);
    expect(isMoneyHeld('delivery_failed', 'mock')).toBe(true);
    expect(isMoneyHeld('ready_for_pickup', 'cod')).toBe(false);
    expect(isMoneyHeld('delivered', 'cod')).toBe(true);
    expect(isMoneyHeld('disputed', 'bank_transfer')).toBe(true);
    expect(isMoneyHeld('completed', 'bank_transfer')).toBe(false);
  });

  it('starts the right deadline on entering a status', () => {
    expect(deadlineStartedBy('verify_payment', 'funds_held')).toBe('handoverDueAt');
    expect(deadlineStartedBy('confirm_cod', 'ready_for_pickup')).toBe('handoverDueAt');
    expect(deadlineStartedBy('mark_ready', 'ready_for_pickup')).toBeNull();
    expect(deadlineStartedBy('deliver', 'delivered')).toBe('inspectionEndsAt');
    expect(deadlineStartedBy('hand_over', 'delivered')).toBe('inspectionEndsAt');
    expect(deadlineStartedBy('confirm_received', 'completed')).toBe('payoutHoldUntil');
    expect(deadlineStartedBy('resolve_partial', 'resolved_partial')).toBe('payoutHoldUntil');
    expect(deadlineStartedBy('resolve_release', 'resolved_release')).toBe('payoutHoldUntil');
    expect(deadlineStartedBy('cancel', 'cancelled')).toBeNull();
  });

  it('has timers whose events are allowed for the system from every status they watch', () => {
    for (const timer of ORDER_TIMERS) {
      for (const status of timer.statuses) {
        expect(() => orderTransition(status, timer.event, 'system', bank)).not.toThrow();
      }
    }
  });
});

describe('normalizePaymentReference', () => {
  it('makes the same reference look the same however it was typed', () => {
    expect(normalizePaymentReference('ft-2409 1234 567')).toBe('FT24091234567');
    expect(normalizePaymentReference('٢٤٠٩١٢٣٤٥٦٧')).toBe('24091234567');
    expect(normalizePaymentReference('#REF:ab.12_34/56')).toBe('REFAB123456');
  });

  it('refuses things that are not references', () => {
    expect(normalizePaymentReference('12345')).toBeNull();
    expect(normalizePaymentReference('تم التحويل')).toBeNull();
    expect(normalizePaymentReference('x'.repeat(41))).toBeNull();
  });
});
