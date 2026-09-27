'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { HeartIcon } from '@/components/icons';
import { useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from '@/lib/api';

export function FavouriteButton({ listingId, initial }: { listingId: string; initial: boolean }) {
  const t = useTranslations('listing');
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = !saved;
    setSaved(next); // optimistic
    try {
      await api(`/listings/${listingId}/favourite`, { method: next ? 'PUT' : 'DELETE' });
    } catch (err) {
      setSaved(!next);
      if (err instanceof ApiRequestError && err.code === 'unauthenticated') router.push('/login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={saved}
      aria-label={t(saved ? 'unsaveLabel' : 'saveLabel')}
      className={`flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3 text-sm ${
        saved ? 'border-danger-600 text-danger-600' : 'border-line text-ink-muted'
      }`}
    >
      <HeartIcon filled={saved} width={20} height={20} />
      {t(saved ? 'saved' : 'save')}
    </button>
  );
}
