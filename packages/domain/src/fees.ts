import type { DeliveryMethod, PaymentMethod } from './order';

/**
 * Checkout settings, stored as rows in `order_configs` (the newest one in effect applies).
 * Orders keep a reference to the row they were priced with, so later changes never
 * alter an existing order.
 */
export interface OrderConfig {
  /** Buyer-protection fee = fixed + price × pct, capped. Sellers pay nothing (like Vinted). */
  protectionFixedMinor: bigint;
  protectionPctBps: number;
  protectionCapMinor: bigint;
  /** Flat fee for a platform courier within the city. */
  courierFeeMinor: bigint;
  /** Cash on delivery only up to this total, and only for buyers with a completed order. */
  codMaxMinor: bigint;
  /** Accounts younger than `newAccountDays` can't place orders above this total. */
  newBuyerMaxMinor: bigint;
  newAccountDays: number;
  paymentHours: number;
  handoverHours: number;
  inspectionHours: number;
  /** A seller's first `newSellerOrders` completed orders are held this long before payout. */
  newSellerHoldDays: number;
  newSellerOrders: number;
}

export interface OrderQuote {
  itemMinor: bigint;
  deliveryMinor: bigint;
  protectionMinor: bigint;
  totalMinor: bigint;
}

const BPS = 10_000n;

/** Fixed + percentage (rounded half up to a whole piastre), never above the cap. */
export function protectionFee(itemMinor: bigint, config: OrderConfig): bigint {
  const pct = (itemMinor * BigInt(config.protectionPctBps) + BPS / 2n) / BPS;
  const fee = config.protectionFixedMinor + pct;
  return fee < config.protectionCapMinor ? fee : config.protectionCapMinor;
}

export function deliveryFee(
  method: DeliveryMethod,
  config: OrderConfig,
  sellerDeliveryFeeMinor = 0n,
): bigint {
  if (method === 'courier') return config.courierFeeMinor;
  if (method === 'seller_arranged') return sellerDeliveryFeeMinor;
  return 0n; // meetup
}

/** The price breakdown shown at checkout and stored on the order. */
export function quoteOrder(
  itemMinor: bigint,
  method: DeliveryMethod,
  config: OrderConfig,
  sellerDeliveryFeeMinor = 0n,
): OrderQuote {
  const deliveryMinor = deliveryFee(method, config, sellerDeliveryFeeMinor);
  const protectionMinor = protectionFee(itemMinor, config);
  return {
    itemMinor,
    deliveryMinor,
    protectionMinor,
    totalMinor: itemMinor + deliveryMinor + protectionMinor,
  };
}

export type CheckoutRefusal =
  | 'cod_needs_courier'
  | 'cod_needs_history'
  | 'cod_over_limit'
  | 'meetup_needs_prepayment'
  | 'new_account_limit';

/**
 * Anti-fraud rules for a new order. Cash on delivery makes the seller prepare an item
 * before any money exists, so it's only for buyers with history and below a cap.
 * Cash at a meetup would bypass escrow, so meetups must be prepaid.
 */
export function checkoutRefusal(
  input: {
    paymentMethod: PaymentMethod;
    deliveryMethod: DeliveryMethod;
    totalMinor: bigint;
    buyerAccountAgeDays: number;
    buyerCompletedOrders: number;
  },
  config: OrderConfig,
): CheckoutRefusal | null {
  if (
    input.buyerAccountAgeDays < config.newAccountDays &&
    input.totalMinor > config.newBuyerMaxMinor
  ) {
    return 'new_account_limit';
  }
  if (input.paymentMethod === 'cod') {
    if (input.deliveryMethod !== 'courier') {
      return input.deliveryMethod === 'meetup' ? 'meetup_needs_prepayment' : 'cod_needs_courier';
    }
    if (input.buyerCompletedOrders < 1) return 'cod_needs_history';
    if (input.totalMinor > config.codMaxMinor) return 'cod_over_limit';
  }
  return null;
}

/** New sellers' earnings wait before they can be withdrawn (fraud buffer). */
export function payoutHoldDays(sellerCompletedOrders: number, config: OrderConfig): number {
  return sellerCompletedOrders < config.newSellerOrders ? config.newSellerHoldDays : 0;
}
