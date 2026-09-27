'use client';

import type { SellerBalance } from '@souqna/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { Card } from './ui';

/** Earnings and refunds, calculated from the ledger. Hidden while everything is zero. */
export function BalanceCard() {
  const t = useTranslations('account');
  const locale = useLocale();
  const [balance, setBalance] = useState<SellerBalance | null>(null);

  useEffect(() => {
    api<SellerBalance>('/me/balance').then(setBalance, () => {});
  }, []);

  if (!balance || Object.values(balance).every((v) => v === '0')) return null;
  const rows = [
    ['balanceAvailable', balance.availableMinor],
    ['balancePending', balance.pendingMinor],
    ['balanceRefunds', balance.refundsMinor],
  ] as const;
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">{t('balanceTitle')}</h2>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        {rows
          .filter(([, v]) => v !== '0')
          .map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-ink-muted">{t(key)}</dt>
              <dd className="font-semibold tabular-nums">{formatPrice(value, locale)}</dd>
            </div>
          ))}
      </dl>
      <p className="mt-2 text-xs text-ink-muted">{t('balanceNote')}</p>
    </Card>
  );
}
