'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { ApiRequestError } from './api';

/** Turns any thrown error into a translated message for the user. */
export function useErrorMessage() {
  const t = useTranslations('errors');
  return useCallback(
    (error: unknown) => t(error instanceof ApiRequestError ? error.code : 'internal_error'),
    [t],
  );
}

/** Translates field-level validation codes returned by the API. */
export function useFieldError() {
  const t = useTranslations('validation');
  return useCallback(
    (code: string | undefined) => (code && t.has(code as never) ? t(code as never) : undefined),
    [t],
  );
}
