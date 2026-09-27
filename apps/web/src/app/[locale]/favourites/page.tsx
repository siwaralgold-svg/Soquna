'use client';

import type { ListingCard as Card } from '@souqna/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ListingGrid } from '@/components/listing-card';
import { Alert } from '@/components/ui';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';
import { useMe } from '@/lib/use-me';

export default function FavouritesPage() {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const { me } = useMe({ allowIncomplete: true });
  const [items, setItems] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    api<Card[]>('/me/favourites').then(setItems, (err: unknown) => setError(errorMessage(err)));
  }, [me, errorMessage]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('favourites.title')}</h1>
      {error && <Alert tone="error">{error}</Alert>}
      {items === null ? (
        <p className="text-ink-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="rounded-card border border-dashed border-line p-6 text-center text-ink-muted">
          {t('favourites.empty')}
        </p>
      ) : (
        <ListingGrid items={items} />
      )}
    </div>
  );
}
