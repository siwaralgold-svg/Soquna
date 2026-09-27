import { describe, expect, it } from 'vitest';
import {
  effectiveOfferStatus,
  isValidOfferAmount,
  nextOfferStatus,
  OFFER_STATUSES,
  OfferTransitionError,
  type OfferActor,
  type OfferEvent,
} from './offer';

const EVENTS: OfferEvent[] = ['accept', 'decline', 'withdraw', 'expire'];
const ACTORS: OfferActor[] = ['buyer', 'seller', 'system'];

describe('offer state machine', () => {
  it.each([
    ['accept', 'seller', 'accepted'],
    ['decline', 'seller', 'declined'],
    ['withdraw', 'buyer', 'withdrawn'],
    ['expire', 'system', 'expired'],
  ] as const)('pending --%s (%s)--> %s', (event, actor, to) => {
    expect(nextOfferStatus('pending', event, actor)).toBe(to);
  });

  it('allows exactly four moves; everything else is rejected', () => {
    let allowed = 0;
    for (const from of OFFER_STATUSES) {
      for (const event of EVENTS) {
        for (const actor of ACTORS) {
          try {
            nextOfferStatus(from, event, actor);
            allowed++;
          } catch (err) {
            expect(err).toBeInstanceOf(OfferTransitionError);
            expect(err).toMatchObject({ from, event, actor });
          }
        }
      }
    }
    expect(allowed).toBe(4);
  });

  it('a buyer can never accept their own offer', () => {
    expect(() => nextOfferStatus('pending', 'accept', 'buyer')).toThrow(OfferTransitionError);
  });
});

describe('effectiveOfferStatus', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  it('treats an overdue pending offer as expired', () => {
    expect(effectiveOfferStatus('pending', new Date('2026-01-01T11:59:59Z'), now)).toBe('expired');
    expect(effectiveOfferStatus('pending', new Date('2026-01-01T12:00:00Z'), now)).toBe('expired');
  });
  it('leaves other offers alone', () => {
    expect(effectiveOfferStatus('pending', new Date('2026-01-02T00:00:00Z'), now)).toBe('pending');
    expect(effectiveOfferStatus('accepted', new Date('2020-01-01T00:00:00Z'), now)).toBe(
      'accepted',
    );
  });
});

describe('isValidOfferAmount', () => {
  it('must be positive and not above the asking price', () => {
    expect(isValidOfferAmount(1n, 100n)).toBe(true);
    expect(isValidOfferAmount(100n, 100n)).toBe(true);
    expect(isValidOfferAmount(0n, 100n)).toBe(false);
    expect(isValidOfferAmount(101n, 100n)).toBe(false);
  });
});
