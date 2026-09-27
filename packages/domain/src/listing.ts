export const LISTING_STATUSES = [
  'draft',
  'pending_review',
  'active',
  'paused',
  'rejected',
  'reserved',
  'sold',
  'removed',
  'deleted',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_CONDITIONS = ['new', 'like_new', 'good', 'fair'] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

export const MAX_LISTING_PHOTOS = 8;

export type ListingActor = 'seller' | 'moderator' | 'system';

export type ListingEvent =
  | 'publish'
  | 'flag_for_review'
  | 'approve'
  | 'reject'
  | 'revise'
  | 'pause'
  | 'resume'
  | 'reserve'
  | 'release'
  | 'release_to_paused'
  | 'mark_sold'
  | 'remove'
  | 'delete';

interface Transition {
  event: ListingEvent;
  from: readonly ListingStatus[];
  to: ListingStatus;
  actors: readonly ListingActor[];
}

/**
 * Every allowed listing status change, in one place. Anything not listed is rejected.
 * `reserve`, `release*` and `mark_sold` are driven by orders (Phase 4).
 */
export const LISTING_TRANSITIONS: readonly Transition[] = [
  { event: 'publish', from: ['draft'], to: 'active', actors: ['seller'] },
  {
    event: 'flag_for_review',
    from: ['draft', 'active', 'paused'],
    to: 'pending_review',
    actors: ['seller', 'system'],
  },
  { event: 'approve', from: ['pending_review'], to: 'active', actors: ['moderator'] },
  { event: 'reject', from: ['pending_review'], to: 'rejected', actors: ['moderator'] },
  { event: 'revise', from: ['rejected'], to: 'draft', actors: ['seller'] },
  { event: 'pause', from: ['active'], to: 'paused', actors: ['seller'] },
  { event: 'resume', from: ['paused'], to: 'active', actors: ['seller'] },
  { event: 'reserve', from: ['active'], to: 'reserved', actors: ['system'] },
  { event: 'release', from: ['reserved'], to: 'active', actors: ['system'] },
  { event: 'release_to_paused', from: ['reserved'], to: 'paused', actors: ['system'] },
  { event: 'mark_sold', from: ['reserved'], to: 'sold', actors: ['system'] },
  {
    event: 'remove',
    from: ['active', 'paused', 'pending_review'],
    to: 'removed',
    actors: ['moderator'],
  },
  {
    event: 'delete',
    from: ['draft', 'active', 'paused', 'rejected', 'pending_review'],
    to: 'deleted',
    actors: ['seller'],
  },
];

export class ListingTransitionError extends Error {
  constructor(
    readonly from: ListingStatus,
    readonly event: ListingEvent,
    readonly actor: ListingActor,
  ) {
    super(`Listing cannot ${event} from ${from} as ${actor}`);
  }
}

export function nextListingStatus(
  from: ListingStatus,
  event: ListingEvent,
  actor: ListingActor,
): ListingStatus {
  const rule = LISTING_TRANSITIONS.find((t) => t.event === event && t.from.includes(from));
  if (!rule || !rule.actors.includes(actor)) throw new ListingTransitionError(from, event, actor);
  return rule.to;
}

/** A listing in an active order can't change under the buyer; sold/removed/deleted are final. */
export function canSellerEdit(status: ListingStatus): boolean {
  return ['draft', 'pending_review', 'active', 'paused', 'rejected'].includes(status);
}

/** Visible to people other than the seller (and moderators). */
export function isPubliclyVisible(status: ListingStatus): boolean {
  return status === 'active' || status === 'reserved' || status === 'sold';
}
