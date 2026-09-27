import { describe, expect, it } from 'vitest';
import {
  canSellerEdit,
  isPubliclyVisible,
  LISTING_STATUSES,
  LISTING_TRANSITIONS,
  ListingTransitionError,
  nextListingStatus,
  type ListingActor,
  type ListingEvent,
} from './listing';

const ACTORS: ListingActor[] = ['seller', 'moderator', 'system'];
const EVENTS = [...new Set(LISTING_TRANSITIONS.map((t) => t.event))] as ListingEvent[];

describe('listing state machine', () => {
  it.each([
    ['draft', 'publish', 'seller', 'active'],
    ['draft', 'flag_for_review', 'seller', 'pending_review'],
    ['active', 'flag_for_review', 'system', 'pending_review'],
    ['paused', 'flag_for_review', 'seller', 'pending_review'],
    ['pending_review', 'approve', 'moderator', 'active'],
    ['pending_review', 'reject', 'moderator', 'rejected'],
    ['rejected', 'revise', 'seller', 'draft'],
    ['active', 'pause', 'seller', 'paused'],
    ['paused', 'resume', 'seller', 'active'],
    ['active', 'reserve', 'system', 'reserved'],
    ['reserved', 'release', 'system', 'active'],
    ['reserved', 'release_to_paused', 'system', 'paused'],
    ['reserved', 'mark_sold', 'system', 'sold'],
    ['active', 'remove', 'moderator', 'removed'],
    ['pending_review', 'remove', 'moderator', 'removed'],
    ['draft', 'delete', 'seller', 'deleted'],
    ['rejected', 'delete', 'seller', 'deleted'],
  ] as const)('%s --%s (%s)--> %s', (from, event, actor, to) => {
    expect(nextListingStatus(from, event, actor)).toBe(to);
  });

  it('rejects every combination that is not in the transition table', () => {
    let allowed = 0;
    for (const from of LISTING_STATUSES) {
      for (const event of EVENTS) {
        for (const actor of ACTORS) {
          const rule = LISTING_TRANSITIONS.find((t) => t.event === event && t.from.includes(from));
          const ok = Boolean(rule?.actors.includes(actor));
          if (ok) {
            allowed++;
            expect(nextListingStatus(from, event, actor)).toBe(rule!.to);
          } else {
            expect(() => nextListingStatus(from, event, actor)).toThrow(ListingTransitionError);
          }
        }
      }
    }
    expect(allowed).toBe(
      LISTING_TRANSITIONS.reduce((n, t) => n + t.from.length * t.actors.length, 0),
    );
  });

  it('never lets a seller touch a reserved, sold, removed or deleted listing', () => {
    for (const from of ['reserved', 'sold', 'removed', 'deleted'] as const) {
      for (const event of EVENTS) {
        expect(() => nextListingStatus(from, event, 'seller')).toThrow(ListingTransitionError);
      }
    }
  });

  it('only moderators approve, reject or remove', () => {
    for (const event of ['approve', 'reject', 'remove'] as const) {
      expect(() => nextListingStatus('pending_review', event, 'seller')).toThrow();
      expect(() => nextListingStatus('pending_review', event, 'system')).toThrow();
    }
  });

  it('describes the failed transition in the error', () => {
    try {
      nextListingStatus('sold', 'pause', 'seller');
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ from: 'sold', event: 'pause', actor: 'seller' });
    }
  });
});

describe('listing rules', () => {
  it('lets sellers edit only listings that are not in an order or final', () => {
    expect(LISTING_STATUSES.filter(canSellerEdit)).toEqual([
      'draft',
      'pending_review',
      'active',
      'paused',
      'rejected',
    ]);
  });

  it('shows active, reserved and sold listings to the public', () => {
    expect(LISTING_STATUSES.filter(isPubliclyVisible)).toEqual(['active', 'reserved', 'sold']);
  });
});
