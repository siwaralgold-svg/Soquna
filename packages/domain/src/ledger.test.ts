import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  displayBalance,
  heldInEscrow,
  postingFor,
  PostingError,
  sellerShare,
  UnbalancedLedgerError,
  type LedgerEntry,
  type OrderMoney,
} from './ledger';
import { orderTransition, type OrderEvent, type OrderStatus } from './order';

const P = 200_000_00n; // item
const D = 5_000_00n; // delivery
const F = 11_000_00n; // protection fee
const T = P + D + F;

function order(overrides: Partial<OrderMoney> = {}): OrderMoney {
  return {
    status: 'payment_submitted',
    paymentMethod: 'bank_transfer',
    deliveryMethod: 'courier',
    buyerId: 'buyer',
    sellerId: 'seller',
    courierId: 'courier',
    itemMinor: P,
    deliveryMinor: D,
    protectionMinor: F,
    totalMinor: T,
    ...overrides,
  };
}

/** Plays events through the state machine and the postings, like the API does. */
function play(
  start: OrderMoney,
  steps: Array<
    [OrderEvent, 'buyer' | 'seller' | 'courier' | 'staff' | 'system', { refundMinor?: bigint }?]
  >,
) {
  const book = new Map<string, bigint>();
  let current = { ...start };
  for (const [event, actor, opts] of steps) {
    const releaseAmount =
      event === 'release_payout' ? -(book.get('seller_pending:seller') ?? 0n) : undefined;
    const entries = postingFor(event, current, { ...opts, amountMinor: releaseAmount });
    for (const e of entries ?? []) {
      const key = e.ownerId ? `${e.account}:${e.ownerId}` : e.account;
      book.set(key, (book.get(key) ?? 0n) + e.amountMinor);
    }
    const to: OrderStatus = orderTransition(current.status, event, actor, current).to;
    current = { ...current, status: to };
  }
  const balance = (key: string) => book.get(key) ?? 0n;
  return { balance, status: current.status, book };
}

describe('assertBalanced', () => {
  it('accepts balanced entries', () => {
    expect(() =>
      assertBalanced([
        { account: 'platform_bank', ownerId: null, amountMinor: 5n },
        { account: 'escrow_held', ownerId: null, amountMinor: -5n },
      ]),
    ).not.toThrow();
  });

  it.each<[string, LedgerEntry[]]>([
    ['one entry', [{ account: 'platform_bank', ownerId: null, amountMinor: 0n }]],
    [
      'a zero entry',
      [
        { account: 'platform_bank', ownerId: null, amountMinor: 0n },
        { account: 'escrow_held', ownerId: null, amountMinor: 0n },
      ],
    ],
    [
      'a non-zero sum',
      [
        { account: 'platform_bank', ownerId: null, amountMinor: 5n },
        { account: 'escrow_held', ownerId: null, amountMinor: -4n },
      ],
    ],
    [
      'a personal account without owner',
      [
        { account: 'seller_balance', ownerId: null, amountMinor: 5n },
        { account: 'escrow_held', ownerId: null, amountMinor: -5n },
      ],
    ],
    [
      'a platform account with an owner',
      [
        { account: 'platform_fees', ownerId: 'x', amountMinor: 5n },
        { account: 'escrow_held', ownerId: null, amountMinor: -5n },
      ],
    ],
  ])('refuses %s', (_name, entries) => {
    expect(() => assertBalanced(entries)).toThrow(UnbalancedLedgerError);
  });
});

describe('displayBalance', () => {
  it('shows assets as debits and what we owe as credits, both positive', () => {
    expect(displayBalance('platform_bank', 100n)).toBe(100n);
    expect(displayBalance('seller_balance', -100n)).toBe(100n);
  });
});

describe('full order lifecycles leave escrow empty', () => {
  it('bank transfer + courier → completed → payout released', () => {
    const { balance, status } = play(order(), [
      ['verify_payment', 'staff'],
      ['mark_ready', 'seller'],
      ['pick_up', 'courier'],
      ['set_off', 'courier'],
      ['deliver', 'courier'],
      ['confirm_received', 'buyer'],
      ['release_payout', 'system'],
    ]);
    expect(status).toBe('payout_released');
    expect(balance('platform_bank')).toBe(T);
    expect(balance('escrow_held')).toBe(0n);
    expect(balance('courier_earnings:courier')).toBe(-D);
    expect(balance('platform_fees')).toBe(-F);
    expect(balance('seller_pending:seller')).toBe(0n);
    expect(balance('seller_balance:seller')).toBe(-P);
  });

  it('cash on delivery: the courier holds the cash until they hand it in', () => {
    const { balance } = play(order({ status: 'created', paymentMethod: 'cod' }), [
      ['confirm_cod', 'seller'],
      ['pick_up', 'courier'],
      ['set_off', 'courier'],
      ['deliver', 'courier'],
      ['auto_complete', 'system'],
    ]);
    expect(balance('courier_cash:courier')).toBe(T);
    expect(balance('courier_earnings:courier')).toBe(-D);
    expect(balance('escrow_held')).toBe(0n);
    expect(balance('seller_pending:seller')).toBe(-P);
    expect(balance('platform_fees')).toBe(-F);
  });

  it('meetup: no delivery fee, the whole total is released on confirmation', () => {
    const meetup = order({
      deliveryMethod: 'meetup',
      deliveryMinor: 0n,
      totalMinor: P + F,
      courierId: null,
    });
    const { balance } = play(meetup, [
      ['verify_payment', 'system'],
      ['mark_ready', 'seller'],
      ['hand_over', 'seller'],
      ['confirm_received', 'buyer'],
    ]);
    expect(balance('escrow_held')).toBe(0n);
    expect(balance('seller_pending:seller')).toBe(-P);
  });

  it('seller-arranged: the seller also gets the delivery fee', () => {
    const own = order({ deliveryMethod: 'seller_arranged', courierId: null });
    expect(sellerShare(own)).toBe(P + D);
    // Delivered but not yet confirmed: everything is still in escrow.
    const delivered = play(own, [
      ['verify_payment', 'staff'],
      ['mark_ready', 'seller'],
      ['ship', 'seller'],
      ['deliver', 'buyer'],
    ]);
    expect(delivered.balance('escrow_held')).toBe(-T);
    const done = play(own, [
      ['verify_payment', 'staff'],
      ['mark_ready', 'seller'],
      ['ship', 'seller'],
      ['deliver', 'buyer'],
      ['confirm_received', 'buyer'],
    ]);
    expect(done.balance('escrow_held')).toBe(0n);
    expect(done.balance('seller_pending:seller')).toBe(-(P + D));
  });
});

describe('refunds', () => {
  it('cancelling a paid order refunds everything held', () => {
    const { balance } = play(order(), [
      ['verify_payment', 'staff'],
      ['cancel', 'buyer'],
    ]);
    expect(balance('escrow_held')).toBe(0n);
    expect(balance('refunds:buyer')).toBe(-T);
  });

  it('an expired hand-over refunds everything', () => {
    const { balance } = play(order(), [
      ['verify_payment', 'staff'],
      ['mark_ready', 'seller'],
      ['expire', 'system'],
    ]);
    expect(balance('refunds:buyer')).toBe(-T);
  });

  it('cancelling unpaid or unfunded orders moves no money', () => {
    expect(postingFor('cancel_unpaid', order({ status: 'awaiting_payment' }))).toBeNull();
    expect(
      postingFor('cancel', order({ status: 'ready_for_pickup', paymentMethod: 'cod' })),
    ).toBeNull();
    expect(
      postingFor('return_to_seller', order({ status: 'delivery_failed', paymentMethod: 'cod' })),
    ).toBeNull();
  });

  it('a failed delivery returned to the seller: the courier keeps the fee', () => {
    const { balance } = play(order(), [
      ['verify_payment', 'staff'],
      ['mark_ready', 'seller'],
      ['pick_up', 'courier'],
      ['fail_delivery', 'courier'],
      ['return_to_seller', 'staff'],
    ]);
    expect(balance('escrow_held')).toBe(0n);
    expect(balance('refunds:buyer')).toBe(-(T - D));
    expect(balance('courier_earnings:courier')).toBe(-D);
  });

  it('a failed delivery with no courier fee refunds everything', () => {
    const free = order({ status: 'delivery_failed', deliveryMinor: 0n, totalMinor: P + F });
    expect(postingFor('return_to_seller', free)).toEqual([
      { account: 'escrow_held', ownerId: null, amountMinor: P + F },
      { account: 'refunds', ownerId: 'buyer', amountMinor: -(P + F) },
    ]);
  });

  it('a dispute refunded in full returns what is left after the courier fee', () => {
    const { balance } = play(order(), [
      ['verify_payment', 'staff'],
      ['mark_ready', 'seller'],
      ['pick_up', 'courier'],
      ['set_off', 'courier'],
      ['deliver', 'courier'],
      ['dispute', 'buyer'],
      ['resolve_refund', 'staff'],
    ]);
    expect(balance('escrow_held')).toBe(0n);
    expect(balance('refunds:buyer')).toBe(-(P + F));
  });

  it('a partial refund splits the item price', () => {
    const r = 50_000_00n;
    const { balance } = play(order(), [
      ['verify_payment', 'staff'],
      ['mark_ready', 'seller'],
      ['pick_up', 'courier'],
      ['set_off', 'courier'],
      ['deliver', 'courier'],
      ['dispute', 'buyer'],
      ['resolve_partial', 'staff', { refundMinor: r }],
      ['release_payout', 'system'],
    ]);
    expect(balance('escrow_held')).toBe(0n);
    expect(balance('refunds:buyer')).toBe(-r);
    expect(balance('seller_balance:seller')).toBe(-(P - r));
    expect(balance('platform_fees')).toBe(-F);
  });

  it('a dispute resolved for the seller releases like a completion', () => {
    const { balance } = play(
      order({ deliveryMethod: 'meetup', deliveryMinor: 0n, totalMinor: P + F }),
      [
        ['verify_payment', 'staff'],
        ['mark_ready', 'seller'],
        ['hand_over', 'seller'],
        ['dispute', 'buyer'],
        ['resolve_release', 'staff'],
      ],
    );
    expect(balance('escrow_held')).toBe(0n);
    expect(balance('seller_pending:seller')).toBe(-P);
  });
});

describe('posting errors', () => {
  const delivered = order({ status: 'disputed' });

  it('needs a valid partial refund amount', () => {
    for (const refundMinor of [undefined, 0n, P]) {
      expect(() => postingFor('resolve_partial', delivered, { refundMinor })).toThrow(PostingError);
    }
  });

  it('needs something to release', () => {
    expect(() => postingFor('release_payout', order({ status: 'completed' }))).toThrow(
      PostingError,
    );
    expect(() =>
      postingFor('release_payout', order({ status: 'completed' }), { amountMinor: 0n }),
    ).toThrow(PostingError);
  });

  it('needs a courier for courier deliveries', () => {
    expect(() =>
      postingFor('deliver', order({ status: 'out_for_delivery', courierId: null })),
    ).toThrow(PostingError);
  });

  it('moves no money for events without a posting', () => {
    expect(postingFor('mark_ready', order({ status: 'funds_held' }))).toBeNull();
    expect(
      postingFor('deliver', order({ status: 'out_for_delivery', deliveryMethod: 'meetup' })),
    ).toBeNull();
  });

  it('knows what is held', () => {
    expect(heldInEscrow(order({ status: 'awaiting_payment' }))).toBe(0n);
    expect(heldInEscrow(order({ status: 'funds_held' }))).toBe(T);
    expect(heldInEscrow(order({ status: 'delivered' }))).toBe(T - D);
    expect(heldInEscrow(order({ status: 'delivered', deliveryMethod: 'meetup' }))).toBe(T);
  });
});
