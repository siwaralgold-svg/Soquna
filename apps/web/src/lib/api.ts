import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type ApiError,
  type ErrorCode,
} from '@souqna/contracts/constants';

export type ClientErrorCode = ErrorCode | 'network';

export class ApiRequestError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    readonly status: number,
    readonly fields: Record<string, string> = {},
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

/**
 * Calls our own API on the same origin. Adds the CSRF header to every write and turns
 * error responses into ApiRequestError with a stable code the UI can translate.
 */
export async function api<T>(
  path: string,
  init: { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {},
): Promise<T> {
  const method = init.method ?? (init.json !== undefined || init.body ? 'POST' : 'GET');
  const headers: Record<string, string> = { ...init.headers };
  if (method !== 'GET') headers[CSRF_HEADER] = CSRF_HEADER_VALUE;
  if (init.json !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch {
    throw new ApiRequestError('network', 0);
  }

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data ?? { error: 'internal_error' }) as ApiError;
    throw new ApiRequestError(err.error, res.status, err.fields, err.retryAfterSeconds);
  }
  return data as T;
}
