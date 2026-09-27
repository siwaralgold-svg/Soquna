import { toAsciiDigits } from './digits';

/**
 * The order and escrow state machine (PROMPT.md §5, docs/plan/phase-0.md §3a).
 * Every allowed status change is listed once, as data, in ORDER_TRANSITIONS.
 * Anything not listed is rejected. The API applies these rules inside one DB transaction
 * that also writes order_events and the ledger (apps/api/src/modules/orders/transition.ts).
 */

export const ORDER_STATUSES = [
  'created',
  'awaiting_payment',
  'payment_submitted',
  'payment_rejected',
  'funds_held',
  'ready_for_pickup',
  'picked_up',
  'out_for_delivery',
  'delivery_failed',
  'delivered',
  'disputed',
  'completed',
  'resolved_refund',
  'resolved_partial',
  'resolved_release',
  'payout_released',
  'cancelled',
  'expired',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** How the buyer pays. A licensed gateway ('psp') is added when one exists. */
export const PAYMENT_METHODS = ['bank_transfer', 'cod', 'mock'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DELIVERY_METHODS = ['courier', 'meetup', 'seller_arranged'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** `staff` is finance or an admin (the API checks which role and 2FA). */
export const ORDER_ACTORS = ['buyer', 'seller', 'courier', 'staff', 'system'] as const;
export type OrderActor = (typeof ORDER_ACTORS)[number];

export const ORDER_EVENTS = [
  'start_payment',
  'confirm_cod',
  'cancel_unpaid',
  'submit_payment',
  'verify_payment',
  'reject_payment',
  'mark_ready',
  'cancel',
  'expire',
  'pick_up',
  'ship',
  'hand_over',
  'set_off',
  'deliver',
  'fail_delivery',
  'retry_delivery',
  'return_to_seller',
  'confirm_received',
  'auto_complete',
  'dispute',
  'resolve_refund',
  'resolve_partial',
  'resolve_release',
  'withdraw_dispute',
  'release_payout',
] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

/** The facts about an order that some transitions depend on. */
export interface OrderFacts {
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
}

/** What happens to the listing when a transition runs. */
export type ListingEffect = 'release' | 'release_to_paused' | 'mark_sold';

export interface OrderTransition {
  event: OrderEvent;
  from: readonly OrderStatus[];
  to: OrderStatus;
  actors: readonly OrderActor[];
  /** Extra condition on the order (and sometimes on who is acting). */
  guard?: (facts: OrderFacts, actor: OrderActor) => boolean;
  listing?: ListingEffect;
}

const prepaid = (f: OrderFacts) => f.paymentMethod !== 'cod';
const byCourier = (f: OrderFacts) => f.deliveryMethod === 'courier';

export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  // Paying
  {
    event: 'start_payment',
    from: ['created'],
    to: 'awaiting_payment',
    actors: ['buyer', 'system'],
    guard: prepaid,
  },
  {
    event: 'confirm_cod',
    from: ['created'],
    to: 'ready_for_pickup',
    actors: ['seller'],
    guard: (f) => f.paymentMethod === 'cod' && byCourier(f),
  },
  {
    event: 'cancel_unpaid',
    from: ['created', 'awaiting_payment', 'payment_rejected'],
    to: 'cancelled',
    actors: ['buyer', 'system'],
    listing: 'release',
  },
  {
    event: 'submit_payment',
    from: ['awaiting_payment', 'payment_rejected'],
    to: 'payment_submitted',
    actors: ['buyer'],
    guard: prepaid,
  },
  // `system` is a payment provider confirming by itself (mock, or a signed gateway webhook).
  {
    event: 'verify_payment',
    from: ['payment_submitted'],
    to: 'funds_held',
    actors: ['staff', 'system'],
  },
  {
    event: 'reject_payment',
    from: ['payment_submitted'],
    to: 'payment_rejected',
    actors: ['staff'],
  },

  // Handing over
  { event: 'mark_ready', from: ['funds_held'], to: 'ready_for_pickup', actors: ['seller'] },
  {
    event: 'cancel',
    from: ['funds_held', 'ready_for_pickup'],
    to: 'cancelled',
    actors: ['buyer', 'seller', 'staff'],
    listing: 'release',
  },
  {
    event: 'expire',
    from: ['funds_held', 'ready_for_pickup'],
    to: 'expired',
    actors: ['system'],
    listing: 'release_to_paused',
  },
  {
    event: 'pick_up',
    from: ['ready_for_pickup'],
    to: 'picked_up',
    actors: ['courier'],
    guard: byCourier,
  },
  {
    event: 'ship',
    from: ['ready_for_pickup'],
    to: 'out_for_delivery',
    actors: ['seller'],
    guard: (f) => f.deliveryMethod === 'seller_arranged',
  },
  {
    event: 'hand_over',
    from: ['ready_for_pickup'],
    to: 'delivered',
    actors: ['seller'],
    guard: (f) => f.deliveryMethod === 'meetup',
  },

  // Delivering
  {
    event: 'set_off',
    from: ['picked_up'],
    to: 'out_for_delivery',
    actors: ['courier'],
    guard: byCourier,
  },
  {
    event: 'deliver',
    from: ['out_for_delivery'],
    to: 'delivered',
    actors: ['courier', 'buyer'],
    // A platform courier enters the buyer's code; for seller-arranged delivery the buyer confirms.
    guard: (f, actor) =>
      (byCourier(f) && actor === 'courier') ||
      (f.deliveryMethod === 'seller_arranged' && actor === 'buyer'),
  },
  {
    event: 'fail_delivery',
    from: ['picked_up', 'out_for_delivery'],
    to: 'delivery_failed',
    actors: ['courier'],
    guard: byCourier,
  },
  {
    event: 'retry_delivery',
    from: ['delivery_failed'],
    to: 'out_for_delivery',
    actors: ['courier', 'staff'],
  },
  {
    event: 'return_to_seller',
    from: ['delivery_failed'],
    to: 'cancelled',
    actors: ['staff'],
    listing: 'release',
  },

  // Inspecting and finishing
  {
    event: 'confirm_received',
    from: ['delivered'],
    to: 'completed',
    actors: ['buyer'],
    listing: 'mark_sold',
  },
  {
    event: 'auto_complete',
    from: ['delivered'],
    to: 'completed',
    actors: ['system'],
    listing: 'mark_sold',
  },
  { event: 'dispute', from: ['delivered'], to: 'disputed', actors: ['buyer'] },
  {
    event: 'resolve_refund',
    from: ['disputed'],
    to: 'resolved_refund',
    actors: ['staff'],
    listing: 'release_to_paused',
  },
  {
    event: 'resolve_partial',
    from: ['disputed'],
    to: 'resolved_partial',
    actors: ['staff'],
    listing: 'mark_sold',
  },
  {
    event: 'resolve_release',
    from: ['disputed'],
    to: 'resolved_release',
    actors: ['staff'],
    listing: 'mark_sold',
  },
  {
    event: 'withdraw_dispute',
    from: ['disputed'],
    to: 'resolved_release',
    actors: ['buyer'],
    listing: 'mark_sold',
  },
  {
    event: 'release_payout',
    from: ['completed', 'resolved_partial', 'resolved_release'],
    to: 'payout_released',
    actors: ['system'],
  },
];

export type OrderTransitionFailure =
  /** No such move from this status, or it doesn't apply to this kind of order. */
  | 'invalid_transition'
  /** The move exists, but this person may not make it. */
  | 'forbidden';

export class OrderTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly event: OrderEvent,
    readonly actor: OrderActor,
    readonly failure: OrderTransitionFailure,
  ) {
    super(`Order cannot ${event} from ${from} as ${actor} (${failure})`);
  }
}

/** Finds the rule for a move, or throws explaining why it isn't allowed. */
export function orderTransition(
  from: OrderStatus,
  event: OrderEvent,
  actor: OrderActor,
  facts: OrderFacts,
): OrderTransition {
  const rule = ORDER_TRANSITIONS.find((t) => t.event === event && t.from.includes(from));
  if (!rule) throw new OrderTransitionError(from, event, actor, 'invalid_transition');
  if (!rule.actors.includes(actor)) throw new OrderTransitionError(from, event, actor, 'forbidden');
  if (rule.guard && !rule.guard(facts, actor)) {
    throw new OrderTransitionError(from, event, actor, 'invalid_transition');
  }
  return rule;
}

/** The events a given person could trigger right now (for showing buttons). */
export function availableOrderEvents(
  status: OrderStatus,
  actor: OrderActor,
  facts: OrderFacts,
): OrderEvent[] {
  return ORDER_TRANSITIONS.filter(
    (t) =>
      t.from.includes(status) && t.actors.includes(actor) && (!t.guard || t.guard(facts, actor)),
  ).map((t) => t.event);
}

/** No further changes can happen. */
export const FINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'cancelled',
  'expired',
  'resolved_refund',
  'payout_released',
];

/**
 * The listing is locked ("reserved") while the order is in one of these. Once the order is
 * completed or resolved in the seller's favour the listing is sold; otherwise it's released.
 */
export const LISTING_LOCKING_STATUSES: readonly OrderStatus[] = [
  'created',
  'awaiting_payment',
  'payment_submitted',
  'payment_rejected',
  'funds_held',
  'ready_for_pickup',
  'picked_up',
  'out_for_delivery',
  'delivery_failed',
  'delivered',
  'disputed',
];

/**
 * Whether the buyer's money is in escrow at this status. Prepaid orders are funded once
 * payment is verified; cash on delivery only once the courier has collected it at the door.
 */
export function isMoneyHeld(status: OrderStatus, paymentMethod: PaymentMethod): boolean {
  if (status === 'delivered' || status === 'disputed') return true;
  if (paymentMethod === 'cod') return false;
  return [
    'funds_held',
    'ready_for_pickup',
    'picked_up',
    'out_for_delivery',
    'delivery_failed',
  ].includes(status);
}

/** Deadlines stored on the order. The timers job acts on them. */
export type OrderDeadline =
  'paymentDueAt' | 'handoverDueAt' | 'inspectionEndsAt' | 'payoutHoldUntil';

/** The deadline that starts when an order enters `to` through `event`, if any. */
export function deadlineStartedBy(event: OrderEvent, to: OrderStatus): OrderDeadline | null {
  if (to === 'funds_held' || event === 'confirm_cod') return 'handoverDueAt';
  if (to === 'delivered') return 'inspectionEndsAt';
  if (to === 'completed' || to === 'resolved_partial' || to === 'resolved_release') {
    return 'payoutHoldUntil';
  }
  return null;
}

/**
 * What the timers job does when a deadline passes. Running it twice is harmless: the second
 * run finds the status already changed and the transition is refused.
 */
export const ORDER_TIMERS: ReadonlyArray<{
  deadline: OrderDeadline;
  statuses: readonly OrderStatus[];
  event: OrderEvent;
}> = [
  {
    deadline: 'paymentDueAt',
    statuses: ['created', 'awaiting_payment', 'payment_rejected'],
    event: 'cancel_unpaid',
  },
  { deadline: 'handoverDueAt', statuses: ['funds_held', 'ready_for_pickup'], event: 'expire' },
  { deadline: 'inspectionEndsAt', statuses: ['delivered'], event: 'auto_complete' },
  {
    deadline: 'payoutHoldUntil',
    statuses: ['completed', 'resolved_partial', 'resolved_release'],
    event: 'release_payout',
  },
];

/** Payment attempts per order (a rejected transfer can be resubmitted, within reason). */
export const MAX_PAYMENT_SUBMISSIONS = 3;

/**
 * Normalises a bank transaction reference so the same transfer can't be claimed twice
 * with different spacing or digits: Arabic-Indic digits → ASCII, upper case, separators
 * removed. Returns null if it doesn't look like a reference (6–40 letters/digits).
 */
export function normalizePaymentReference(input: string): string | null {
  const text = toAsciiDigits(input)
    .toUpperCase()
    .replace(/[\s\-_./#:]/g, '');
  return /^[A-Z0-9]{6,40}$/.test(text) ? text : null;
}
