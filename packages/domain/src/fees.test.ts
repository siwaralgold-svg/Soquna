import { describe, expect, it } from 'vitest';
import {
  checkoutRefusal,
  deliveryFee,
  payoutHoldDays,
  protectionFee,
  quoteOrder,
  type OrderConfig,
} from './fees';

const SDG = 100n;
const config: OrderConfig = {
  protectionFixedMinor: 1_000n * SDG,
  protectionPctBps: 500, // 5 %
  protectionCapMinor: 25_000n * SDG,
  courierFeeMinor: 5_000n * SDG,
  codMaxMinor: 300_000n * SDG,
  newBuyerMaxMinor: 500_000n * SDG,
  newAccountDays: 7,
  paymentHours: 24,
  handoverHours: 72,
  inspectionHours: 48,
  newSellerHoldDays: 7,
  newSellerOrders: 3,
};

describe('protectionFee', () => {
  it('is fixed + percentage', () => {
    expect(protectionFee(100_000n * SDG, config)).toBe(6_000n * SDG);
  });

  it('rounds the percentage half up to a whole piastre', () => {
    expect(protectionFee(1n, { ...config, protectionFixedMinor: 0n })).toBe(0n); // 0.05 → 0
    expect(protectionFee(10n, { ...config, protectionFixedMinor: 0n })).toBe(1n); // 0.5 → 1
    expect(protectionFee(29n, { ...config, protectionFixedMinor: 0n })).toBe(1n); // 1.45 → 1
  });

  it('never goes above the cap', () => {
    expect(protectionFee(1_000_000n * SDG, config)).toBe(25_000n * SDG);
    expect(protectionFee(480_000n * SDG, config)).toBe(25_000n * SDG); // exactly the cap
  });
});

describe('quoteOrder', () => {
  it('adds item, delivery and protection', () => {
    expect(quoteOrder(200_000n * SDG, 'courier', config)).toEqual({
      itemMinor: 200_000n * SDG,
      deliveryMinor: 5_000n * SDG,
      protectionMinor: 11_000n * SDG,
      totalMinor: 216_000n * SDG,
    });
  });

  it('charges no delivery for meetups and the seller’s fee for seller-arranged', () => {
    expect(deliveryFee('meetup', config)).toBe(0n);
    expect(deliveryFee('seller_arranged', config)).toBe(0n);
    expect(deliveryFee('seller_arranged', config, 3_000n * SDG)).toBe(3_000n * SDG);
    expect(quoteOrder(10_000n * SDG, 'meetup', config).totalMinor).toBe(11_500n * SDG);
    expect(quoteOrder(10_000n * SDG, 'seller_arranged', config, 2_000n).deliveryMinor).toBe(2_000n);
  });
});

describe('checkoutRefusal', () => {
  const base = {
    paymentMethod: 'bank_transfer' as const,
    deliveryMethod: 'courier' as const,
    totalMinor: 100_000n * SDG,
    buyerAccountAgeDays: 30,
    buyerCompletedOrders: 0,
  };

  it('allows an ordinary prepaid order', () => {
    expect(checkoutRefusal(base, config)).toBeNull();
    expect(checkoutRefusal({ ...base, deliveryMethod: 'meetup' }, config)).toBeNull();
  });

  it('caps what brand-new accounts can spend', () => {
    const young = { ...base, buyerAccountAgeDays: 2 };
    expect(checkoutRefusal({ ...young, totalMinor: 500_000n * SDG }, config)).toBeNull();
    expect(checkoutRefusal({ ...young, totalMinor: 500_001n * SDG }, config)).toBe(
      'new_account_limit',
    );
    expect(checkoutRefusal({ ...base, totalMinor: 900_000n * SDG }, config)).toBeNull();
  });

  it('limits cash on delivery', () => {
    const cod = { ...base, paymentMethod: 'cod' as const, buyerCompletedOrders: 1 };
    expect(checkoutRefusal(cod, config)).toBeNull();
    expect(checkoutRefusal({ ...cod, buyerCompletedOrders: 0 }, config)).toBe('cod_needs_history');
    expect(checkoutRefusal({ ...cod, totalMinor: 300_001n * SDG }, config)).toBe('cod_over_limit');
    expect(checkoutRefusal({ ...cod, deliveryMethod: 'meetup' }, config)).toBe(
      'meetup_needs_prepayment',
    );
    expect(checkoutRefusal({ ...cod, deliveryMethod: 'seller_arranged' }, config)).toBe(
      'cod_needs_courier',
    );
  });
});

describe('payoutHoldDays', () => {
  it('holds a new seller’s first orders', () => {
    expect(payoutHoldDays(0, config)).toBe(7);
    expect(payoutHoldDays(2, config)).toBe(7);
    expect(payoutHoldDays(3, config)).toBe(0);
  });
});
