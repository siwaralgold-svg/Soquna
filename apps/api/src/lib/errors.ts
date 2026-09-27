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
