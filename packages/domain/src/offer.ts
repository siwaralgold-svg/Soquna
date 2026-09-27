export const OFFER_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn', 'expired'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export type OfferEvent = 'accept' | 'decline' | 'withdraw' | 'expire';
export type OfferActor = 'buyer' | 'seller' | 'system';

/** An offer the seller doesn't answer within this time expires. */
export const OFFER_TTL_HOURS = 48;

const TRANSITIONS: Record<OfferEvent, { to: OfferStatus; actor: OfferActor }> = {
  accept: { to: 'accepted', actor: 'seller' },
  decline: { to: 'declined', actor: 'seller' },
  withdraw: { to: 'withdrawn', actor: 'buyer' },
  expire: { to: 'expired', actor: 'system' },
};

export class OfferTransitionError extends Error {
  constructor(
    readonly from: OfferStatus,
    readonly event: OfferEvent,
    readonly actor: OfferActor,
  ) {
    super(`Offer cannot ${event} from ${from} as ${actor}`);
  }
}

/** Only a pending offer can change, and only by the right person. */
export function nextOfferStatus(
  from: OfferStatus,
  event: OfferEvent,
  actor: OfferActor,
): OfferStatus {
  const rule = TRANSITIONS[event];
  if (from !== 'pending' || rule.actor !== actor)
    throw new OfferTransitionError(from, event, actor);
  return rule.to;
}

/** A pending offer past its expiry counts as expired, even before a job marks it. */
export function effectiveOfferStatus(status: OfferStatus, expiresAt: Date, now: Date): OfferStatus {
  return status === 'pending' && expiresAt.getTime() <= now.getTime() ? 'expired' : status;
}

/** Offers must be positive and can't be above the asking price. */
export function isValidOfferAmount(amountMinor: bigint, priceMinor: bigint): boolean {
  return amountMinor > 0n && amountMinor <= priceMinor;
}
