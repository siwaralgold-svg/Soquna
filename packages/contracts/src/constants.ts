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
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: ErrorCode;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
}
