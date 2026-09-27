import type { ErrorCode } from '@souqna/contracts';

const STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  csrf_failed: 403,
  account_suspended: 403,
  not_found: 404,
  upload_too_large: 413,
  upload_invalid: 415,
  otp_invalid: 400,
  otp_expired: 400,
  otp_too_many_attempts: 429,
  rate_limited: 429,
  conflict: 409,
  idempotency_conflict: 409,
  listing_prohibited: 422,
  listing_limit_reached: 403,
  listing_unavailable: 409,
  chat_limit_reached: 429,
  offer_not_allowed: 409,
  order_not_allowed: 422,
  order_limit_reached: 429,
  payment_reference_used: 409,
  mfa_required: 403,
  internal_error: 500,
};

export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    readonly extra: { fields?: Record<string, string>; retryAfterSeconds?: number } = {},
  ) {
    super(code);
    this.statusCode = STATUS[code];
  }
}

/** True when a query failed on the named unique index/constraint (Postgres code 23505). */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const pg = e as Error & { code?: string; constraint_name?: string };
    if (pg.code === '23505' && pg.constraint_name === constraint) return true;
  }
  return false;
}
