import {
  isMoneyHeld,
  type DeliveryMethod,
  type OrderEvent,
  type OrderStatus,
  type PaymentMethod,
} from './order';

/**
 * Double-entry ledger (docs/plan/phase-0.md §4). Every movement of money is one transaction
 * of two or more entries: signed bigint minor units, + debit / − credit, summing to zero.
 * Balances are always SUM(entries); they are never stored.
 */
export const LEDGER_ACCOUNTS = [
  'platform_bank',
  'buyer_payments_clearing',
  'escrow_held',
  'platform_fees',
  'seller_pending',
  'seller_balance',
  'payouts_in_flight',
  'courier_cash',
  'courier_earnings',
  'refunds',
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

/** Accounts kept per person; the others are single platform accounts. */
export const OWNED_ACCOUNTS: readonly LedgerAccount[] = [
  'seller_pending',
  'seller_balance',
  'courier_cash',
  'courier_earnings',
  'refunds',
];

/** Assets (what we have or are owed) are debit-normal; what we owe others is credit-normal. */
export const DEBIT_NORMAL: readonly LedgerAccount[] = ['platform_bank', 'courier_cash'];

export interface LedgerEntry {
  account: LedgerAccount;
  /** The person for per-person accounts, null for platform accounts. */
  ownerId: string | null;
  amountMinor: bigint;
}

export class UnbalancedLedgerError extends Error {}

/** Every transaction must have 2+ non-zero entries that sum to zero. */
export function assertBalanced(entries: readonly LedgerEntry[]): void {
  if (entries.length < 2)
    throw new UnbalancedLedgerError('a transaction needs at least two entries');
  let sum = 0n;
  for (const e of entries) {
    if (e.amountMinor === 0n) throw new UnbalancedLedgerError(`zero entry on ${e.account}`);
    if (OWNED_ACCOUNTS.includes(e.account) !== (e.ownerId !== null)) {
      throw new UnbalancedLedgerError(`wrong owner on ${e.account}`);
    }
    sum += e.amountMinor;
  }
  if (sum !== 0n) throw new UnbalancedLedgerError(`entries sum to ${sum}, not 0`);
}

/** The balance as people understand it: positive = money in the account. */
export function displayBalance(account: LedgerAccount, sumMinor: bigint): bigint {
  return DEBIT_NORMAL.includes(account) ? sumMinor : -sumMinor;
}

/** Money facts about an order that the postings need (all stored on the order). */
export interface OrderMoney {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  buyerId: string;
  sellerId: string;
  courierId: string | null;
  itemMinor: bigint;
  deliveryMinor: bigint;
  protectionMinor: bigint;
  totalMinor: bigint;
}

export class PostingError extends Error {}

/** Adds entries on the same account together and drops zeros, so a transaction stays tidy. */
function combine(entries: LedgerEntry[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const e of entries) {
    const same = out.find((o) => o.account === e.account && o.ownerId === e.ownerId);
    if (same) same.amountMinor += e.amountMinor;
    else out.push({ ...e });
  }
  return out.filter((e) => e.amountMinor !== 0n);
}

function courierOf(order: OrderMoney): string {
  if (!order.courierId) throw new PostingError('a courier must be assigned');
  return order.courierId;
}

/**
 * What is in escrow for this order right now. A platform courier's fee leaves escrow when
 * the item is delivered (L4), so after delivery it's the rest.
 */
export function heldInEscrow(order: OrderMoney): bigint {
  if (!isMoneyHeld(order.status, order.paymentMethod)) return 0n;
  const delivered = order.status === 'delivered' || order.status === 'disputed';
  return delivered && order.deliveryMethod === 'courier'
    ? order.totalMinor - order.deliveryMinor
    : order.totalMinor;
}

/** The seller's share when released: the item price, plus the delivery fee if they delivered. */
export function sellerShare(order: OrderMoney): bigint {
  return order.itemMinor + (order.deliveryMethod === 'seller_arranged' ? order.deliveryMinor : 0n);
}

/**
 * The ledger entries for an order event (codes L1–L8 in the plan), or null when the event
 * moves no money. Called with the order as it is *before* the event.
 *
 * - `refundMinor` is required for `resolve_partial`.
 * - `amountMinor` is required for `release_payout` (the seller's pending earnings for this order).
 */
export function postingFor(
  event: OrderEvent,
  order: OrderMoney,
  opts: { refundMinor?: bigint; amountMinor?: bigint } = {},
): LedgerEntry[] | null {
  const { buyerId, sellerId } = order;
  const T = order.totalMinor;
  const D = order.deliveryMinor;
  const F = order.protectionMinor;
  let entries: LedgerEntry[];

  switch (event) {
    case 'verify_payment': // L1: bank transfer verified
      entries = [
        { account: 'platform_bank', ownerId: null, amountMinor: T },
        { account: 'escrow_held', ownerId: null, amountMinor: -T },
      ];
      break;

    case 'deliver': {
      if (order.deliveryMethod !== 'courier') return null; // seller-arranged: nothing moves yet
      const courier = courierOf(order);
      entries = [
        // L2: cash collected at the door (COD only)
        ...(order.paymentMethod === 'cod'
          ? [
              { account: 'courier_cash' as const, ownerId: courier, amountMinor: T },
              { account: 'escrow_held' as const, ownerId: null, amountMinor: -T },
            ]
          : []),
        // L4: the courier has earned the delivery fee
        { account: 'escrow_held', ownerId: null, amountMinor: D },
        { account: 'courier_earnings', ownerId: courier, amountMinor: -D },
      ];
      break;
    }

    case 'cancel':
    case 'expire':
    case 'resolve_refund': {
      // L7: everything still held goes back to the buyer.
      const held = heldInEscrow(order);
      if (held === 0n) return null;
      entries = [
        { account: 'escrow_held', ownerId: null, amountMinor: held },
        { account: 'refunds', ownerId: buyerId, amountMinor: -held },
      ];
      break;
    }

    case 'return_to_seller': {
      // L7 after a failed delivery: the courier keeps the fee for the attempt, the rest is refunded.
      const held = heldInEscrow(order);
      if (held === 0n) return null;
      const courierFee = D; // only platform-courier deliveries can fail

      entries = [
        { account: 'escrow_held', ownerId: null, amountMinor: held },
        { account: 'refunds', ownerId: buyerId, amountMinor: -(held - courierFee) },
        ...(courierFee > 0n
          ? [
              {
                account: 'courier_earnings' as const,
                ownerId: courierOf(order),
                amountMinor: -courierFee,
              },
            ]
          : []),
      ];
      break;
    }

    case 'confirm_received':
    case 'auto_complete':
    case 'resolve_release':
    case 'withdraw_dispute': {
      // L5: the seller's share goes to their pending balance, the fee to us.
      const share = sellerShare(order);
      entries = [
        { account: 'escrow_held', ownerId: null, amountMinor: share + F },
        { account: 'seller_pending', ownerId: sellerId, amountMinor: -share },
        { account: 'platform_fees', ownerId: null, amountMinor: -F },
      ];
      break;
    }

    case 'resolve_partial': {
      // L8: part of the item price goes back to the buyer.
      const share = sellerShare(order);
      const r = opts.refundMinor;
      if (r === undefined || r <= 0n || r >= order.itemMinor) {
        throw new PostingError('a partial refund must be above 0 and below the item price');
      }
      entries = [
        { account: 'escrow_held', ownerId: null, amountMinor: share + F },
        { account: 'refunds', ownerId: buyerId, amountMinor: -r },
        { account: 'seller_pending', ownerId: sellerId, amountMinor: -(share - r) },
        { account: 'platform_fees', ownerId: null, amountMinor: -F },
      ];
      break;
    }

    case 'release_payout': {
      // L6: the hold is over; the money becomes withdrawable.
      const a = opts.amountMinor;
      if (a === undefined || a <= 0n) throw new PostingError('nothing to release');
      entries = [
        { account: 'seller_pending', ownerId: sellerId, amountMinor: a },
        { account: 'seller_balance', ownerId: sellerId, amountMinor: -a },
      ];
      break;
    }

    default:
      return null;
  }

  const result = combine(entries);
  assertBalanced(result);
  return result;
}
