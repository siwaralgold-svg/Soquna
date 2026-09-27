'use client';

import type { MoneyBreakdown as Amounts } from '@souqna/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/format';

/** Item + delivery + buyer protection = total, the same way at checkout and on the order. */
export function MoneyBreakdown({
  amounts,
  agreed = false,
}: {
  amounts: Amounts;
  agreed?: boolean;
}) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const row = (label: string, minor: string, hint?: string) => (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt>
        {label}
        {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
      </dt>
      <dd className="shrink-0 tabular-nums">{formatPrice(minor, locale)}</dd>
    </div>
  );
  return (
    <dl className="divide-y divide-line text-sm">
      {row(agreed ? t('offerPrice') : t('item'), amounts.itemMinor)}
      {row(t('deliveryFee'), amounts.deliveryMinor)}
      {row(t('protectionFee'), amounts.protectionMinor, t('protectionHint'))}
      <div className="flex items-center justify-between gap-3 pt-2 text-base font-bold">
        <dt>{t('total')}</dt>
        <dd className="tabular-nums text-brand-700" data-testid="order-total">
          {formatPrice(amounts.totalMinor, locale)}
        </dd>
      </div>
    </dl>
  );
}
