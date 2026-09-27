'use client';

import { REPORT_REASONS, type ReportReason } from '@souqna/contracts/constants';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert, Button } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

export function ReportForm({ listingId }: { listingId: string }) {
  const t = useTranslations('listing');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!reason) return;
    setState('sending');
    setError(null);
    try {
      await api(`/listings/${listingId}/report`, { json: { reason, note: note || undefined } });
      setState('sent');
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'unauthenticated') {
        router.push('/login');
        return;
      }
      setError(errorMessage(err));
      setState('idle');
    }
  }

  if (state === 'sent') return <Alert tone="success">{t('reportThanks')}</Alert>;

  return (
    <details className="rounded-card border border-line bg-surface">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm text-danger-600">
        {t('report')}
      </summary>
      <form onSubmit={onSubmit} className="space-y-3 px-4 pb-4">
        <fieldset>
          <legend className="mb-2 font-medium">{t('reportTitle')}</legend>
          <div className="space-y-1">
            {REPORT_REASONS.map((r) => (
              <label key={r} className="flex min-h-10 items-center gap-2">
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="accent-brand-600"
                />
                {t(`reason_${r}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block space-y-1">
          <span className="text-sm">{t('reportNote')}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded-control border border-line p-3"
          />
        </label>
        {error && <Alert tone="error">{error}</Alert>}
        <Button
          type="submit"
          variant="danger"
          className="w-full"
          disabled={!reason || state === 'sending'}
        >
          {t('reportSend')}
        </Button>
      </form>
    </details>
  );
}
