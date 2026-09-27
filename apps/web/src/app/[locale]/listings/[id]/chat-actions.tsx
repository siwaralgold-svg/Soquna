'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, buttonClasses } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

/** "Chat with seller" and "Make an offer": both open (or reuse) the chat for this listing. */
export function ChatActions({ listingId, negotiable }: { listingId: string; negotiable: boolean }) {
  const t = useTranslations('listing');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(withOffer: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>('/conversations', { json: { listingId } });
      router.push(withOffer ? `/chats/${id}?offer=1` : `/chats/${id}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'unauthenticated') router.push('/login');
      else setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className={`grid gap-2 ${negotiable ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void open(false)}
          className={buttonClasses('secondary')}
        >
          {busy ? t('chatStarting') : t('chatSeller')}
        </button>
        {negotiable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void open(true)}
            className={buttonClasses('secondary')}
          >
            {t('makeOffer')}
          </button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
