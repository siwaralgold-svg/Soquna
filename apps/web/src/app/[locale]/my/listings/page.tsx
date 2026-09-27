'use client';

import type { ListingCard as Card } from '@souqna/contracts';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ListingCard } from '@/components/listing-card';
import { Alert, buttonClasses } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';
import { useMe } from '@/lib/use-me';

type Action = 'publish' | 'pause' | 'resume' | 'delete';

const ACTIONS: Record<string, Action[]> = {
  draft: ['publish', 'delete'],
  active: ['pause', 'delete'],
  paused: ['resume', 'delete'],
  rejected: ['delete'],
  pending_review: ['delete'],
};

const EDITABLE = new Set(['draft', 'active', 'paused', 'rejected', 'pending_review']);

export default function MyListingsPage() {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const { me } = useMe();
  const [items, setItems] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => api<Card[]>('/me/listings').then(setItems, (err: unknown) => setError(errorMessage(err))),
    [errorMessage],
  );

  useEffect(() => {
    if (me) load();
  }, [me, load]);

  async function act(id: string, action: Action) {
    if (action === 'delete' && !window.confirm(t('myListings.confirmDelete'))) return;
    setError(null);
    try {
      await api(`/listings/${id}/actions`, { json: { action } });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('myListings.title')}</h1>
      {error && <Alert tone="error">{error}</Alert>}
      {items === null ? (
        <p className="text-ink-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <div className="rounded-card border border-dashed border-line p-6 text-center">
          <p className="text-ink-muted">{t('myListings.empty')}</p>
          <Link href="/sell" className={buttonClasses('primary', 'mt-4')}>
            {t('myListings.sellFirst')}
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {items.map((item) => (
            <li key={item.id} className="space-y-2">
              <ListingCard listing={item} showStatus />
              <div className="flex flex-wrap gap-1">
                {EDITABLE.has(item.status) && (
                  <Link
                    href={`/listings/${item.id}/edit`}
                    className="inline-flex min-h-10 items-center rounded-control border border-line px-3 text-sm"
                  >
                    {t('myListings.edit')}
                  </Link>
                )}
                {(ACTIONS[item.status] ?? []).map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => void act(item.id, action)}
                    className={`inline-flex min-h-10 items-center rounded-control border px-3 text-sm ${
                      action === 'delete' ? 'border-danger-600 text-danger-600' : 'border-line'
                    }`}
                  >
                    {t(`myListings.${action}`)}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
