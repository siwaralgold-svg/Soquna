// Plain constants and types with no runtime dependencies, safe to import in browser code
// without pulling zod into the bundle.

/** Custom header every state-changing request must carry (CSRF defence, see decision 005). */
export const CSRF_HEADER = 'x-souqna-csrf';
export const CSRF_HEADER_VALUE = '1';

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Stable error codes. The web app maps each one to an i18n message. */
export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'csrf_failed',
  'rate_limited',
  'otp_invalid',
  'otp_expired',
  'otp_too_many_attempts',
  'account_suspended',
  'upload_invalid',
  'upload_too_large',
  'conflict',
  'idempotency_conflict',
  'listing_prohibited',
  'listing_limit_reached',
  'listing_unavailable',
  'chat_limit_reached',
  'offer_not_allowed',
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Header that makes a write safe to retry (see decision 007). */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Photo widths stored for every listing photo. */
export const PHOTO_WIDTHS = [320, 800, 1280] as const;
export type PhotoWidth = (typeof PHOTO_WIDTHS)[number];

export const REPORT_REASONS = [
  'prohibited',
  'scam',
  'wrong_category',
  'offensive',
  'duplicate',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const LISTING_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc'] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

export interface ApiError {
  error: ErrorCode;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
}

/** Socket.IO path, under /api so it goes through the same routing as the API. */
export const REALTIME_PATH = '/api/socket.io';

export const CHAT_TEXT_MAX = 1000;
export const OFFER_ACTIONS = ['accept', 'decline', 'withdraw'] as const;
export type OfferAction = (typeof OFFER_ACTIONS)[number];

/** Events the server pushes over Socket.IO. Each carries a ChatMessage. */
export const REALTIME_EVENTS = {
  message: 'chat:message',
  messageUpdated: 'chat:message-updated',
} as const;

export interface UnreadCount {
  signedIn: boolean;
  count: number;
}
