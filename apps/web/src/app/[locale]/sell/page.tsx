'use client';

import { useTranslations } from 'next-intl';
import { ListingForm } from '@/components/listing-form';
import { Alert } from '@/components/ui';
import { useErrorMessage } from '@/lib/use-error-message';
import { useMe } from '@/lib/use-me';

export default function SellPage() {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  // Sends visitors to /login, and people with an incomplete profile to /onboarding.
  const { me, error } = useMe();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('sell.title')}</h1>
      {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
      {me ? (
        <ListingForm me={me} />
      ) : (
        !error && <p className="text-ink-muted">{t('common.loading')}</p>
      )}
    </div>
  );
}
