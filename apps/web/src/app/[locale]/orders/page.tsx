'use client';

import type { OrderSummary } from '@souqna/contracts';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from '@/lib/api';
import { formatPrice, photoUrl } from '@/lib/format';
import { useErrorMessage } from '@/lib/use-error-message';

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersList />
    </Suspense>
  );
}

function OrdersList() {
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const role = useSearchParams().get('role') === 'selling' ? 'selling' : 'buying';
  const [items, setItems] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<OrderSummary[]>(`/orders?role=${role}`).then(
      (data) => {
        setItems(data);
        setError(null);
      },
      (err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'unauthenticated')
          router.replace('/login');
        else setError(errorMessage(err));
      },
    );
  }, [role, router, errorMessage]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('orders.title')}</h1>
      <nav
        className="grid grid-cols-2 gap-1 rounded-control bg-canvas p-1"
        aria-label={t('orders.title')}
      >
        {(['buying', 'selling'] as const).map((r) => (
          <Link
            key={r}
            href={r === 'buying' ? '/orders' : '/orders?role=selling'}
            aria-current={role === r ? 'page' : undefined}
            className={`flex min-h-11 items-center justify-center rounded-control text-sm font-medium ${
              role === r ? 'bg-surface shadow-sm' : 'text-ink-muted'
            }`}
          >
            {t(`orders.${r}`)}
          </Link>
        ))}
      </nav>
      {error && <Alert tone="error">{error}</Alert>}
      {items === null ? (
        !error && <p className="text-ink-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="rounded-card border border-dashed border-line p-6 text-center text-ink-muted">
          {t('orders.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {items.map((o) => (
            <li key={o.id}>
              <Link
                href={`/orders/${o.id}`}
                className="flex items-center gap-3 p-3 hover:bg-canvas"
              >
                {o.listing.coverPhotoId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small WebP from our API
                  <img
                    src={photoUrl(o.listing.coverPhotoId, 320)}
                    alt=""
                    width={56}
                    height={56}
                    loading="lazy"
                    className="size-14 shrink-0 rounded-control bg-canvas object-cover"
                  />
                ) : (
                  <span aria-hidden className="size-14 shrink-0 rounded-control bg-canvas" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{o.listing.title}</p>
                  <p className="text-sm text-ink-muted">
                    {t(`orderStatus.${o.status}`)} · {formatPrice(o.totalMinor, locale)}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {o.counterpart.displayName} ·{' '}
                    {format.relativeTime(new Date(o.updatedAt), new Date())}
                  </p>
                </div>
                {o.needsAction && (
                  <span className="shrink-0 rounded-full bg-accent-100 px-2 py-0.5 text-xs font-semibold text-accent-700">
                    {t('orders.needsAction')}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
