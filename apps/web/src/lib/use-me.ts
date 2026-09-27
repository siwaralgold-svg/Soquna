'use client';

import type { MeResponse } from '@souqna/contracts';
import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from './api';

/**
 * Loads the logged-in user. Sends the visitor to /login when there is no session, and to
 * /onboarding when the profile is incomplete (unless `allowIncomplete`).
 */
export function useMe({ allowIncomplete = false } = {}) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    api<MeResponse>('/me').then(
      (data) => {
        if (!active) return;
        if (!data.profileComplete && !allowIncomplete) router.replace('/onboarding');
        else setMe(data);
      },
      (err: unknown) => {
        if (!active) return;
        if (err instanceof ApiRequestError && err.code === 'unauthenticated')
          router.replace('/login');
        else setError(err);
      },
    );
    return () => {
      active = false;
    };
  }, [allowIncomplete, router]);

  return { me, setMe, error };
}
