'use client';

import type { StaffMe, StaffPayment } from '@souqna/contracts';
import { IDEMPOTENCY_HEADER } from '@souqna/contracts/constants';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, buttonClasses, Card, TextInput } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from '@/lib/api';
import { formatPrice, photoUrl } from '@/lib/format';
import { useErrorMessage } from '@/lib/use-error-message';

type Tab = 'submitted' | 'verified' | 'rejected';

/**
 * Finance: check bank transfers against the bank statement and verify or reject them.
 * Only staff with the finance or admin role, after entering a 2FA code, get any data;
 * everyone else sees "not found" from the API.
 */
export default function AdminPaymentsPage() {
  const t = useTranslations();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(() => {
    api<StaffMe>('/staff/me').then(setMe, (err: unknown) => {
      if (err instanceof ApiRequestError && err.code === 'unauthenticated')
        router.replace('/login');
      else setError(errorMessage(err));
    });
  }, [router, errorMessage]);

  useEffect(loadMe, [loadMe]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!me) return <p className="text-ink-muted">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
      {!me.mfaEnrolled ? (
        <Alert tone="error">{t('admin.mfaNotEnrolled')}</Alert>
      ) : !me.mfaVerified ? (
        <MfaForm onVerified={loadMe} />
      ) : (
        <PaymentQueue />
      )}
    </div>
  );
}

function MfaForm({ onVerified }: { onVerified: () => void }) {
  const t = useTranslations('admin');
  const errorMessage = useErrorMessage();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/staff/mfa', { json: { code: code.trim() } });
      onVerified();
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <h2 className="font-semibold">{t('mfaTitle')}</h2>
        <p className="text-sm text-ink-muted">{t('mfaHint')}</p>
        <label htmlFor="mfa-code" className="block font-medium">
          {t('mfaCode')}
        </label>
        <TextInput
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        {error && <Alert tone="error">{error}</Alert>}
        <button
          type="submit"
          disabled={code.length !== 6}
          className={buttonClasses('primary', 'w-full')}
        >
          {t('mfaSubmit')}
        </button>
      </form>
    </Card>
  );
}

function PaymentQueue() {
  const t = useTranslations('admin');
  const errorMessage = useErrorMessage();
  const [tab, setTab] = useState<Tab>('submitted');
  const [items, setItems] = useState<StaffPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<StaffPayment[]>(`/staff/payments?status=${tab}`).then(setItems, (err: unknown) =>
      setError(errorMessage(err)),
    );
  }, [tab, errorMessage]);

  useEffect(load, [load]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">{t('checkHint')}</p>
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-control bg-canvas p-1">
        {(['submitted', 'verified', 'rejected'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={tab === s}
            onClick={() => {
              setItems(null);
              setTab(s);
            }}
            className={`min-h-11 rounded-control text-sm font-medium ${tab === s ? 'bg-surface shadow-sm' : 'text-ink-muted'}`}
          >
            {t(`tab_${s}`)}
          </button>
        ))}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {items?.length === 0 && <p className="text-center text-ink-muted">{t('empty')}</p>}
      <ul className="space-y-3">
        {items?.map((p) => (
          <li key={p.id}>
            <PaymentCard payment={p} onDone={load} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaymentCard({ payment, onDone }: { payment: StaffPayment; onDone: () => void }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: 'verify' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      await api(`/staff/payments/${payment.id}/${action}`, {
        json: action === 'reject' ? { reason: reason.trim() } : {},
        headers: { [IDEMPOTENCY_HEADER]: crypto.randomUUID() },
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold" data-testid="payment-order">
          {t('order', { code: payment.order.code })}
        </p>
        <time dateTime={payment.createdAt} className="text-xs text-ink-muted">
          {format.relativeTime(new Date(payment.createdAt), new Date())}
        </time>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">{t('amount')}</dt>
        <dd className="font-bold">{formatPrice(payment.amountMinor, locale)}</dd>
        <dt className="text-ink-muted">{t('reference')}</dt>
        <dd>
          <bdi dir="ltr" className="font-mono">
            {payment.reference}
          </bdi>
        </dd>
      </dl>
      <p className="text-sm">
        {t('buyer', { name: payment.buyer.displayName, days: payment.buyer.accountAgeDays })}
      </p>
      {payment.previousRejections > 0 && (
        <p className="text-sm text-accent-700">
          {t('previousRejections', { n: payment.previousRejections })}
        </p>
      )}
      {payment.proofId && (
        <a
          href={photoUrl(payment.proofId, 1280)}
          target="_blank"
          rel="noopener"
          className="inline-block"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- private image from our API */}
          <img
            src={photoUrl(payment.proofId, 320)}
            alt={t('proof')}
            width={96}
            height={96}
            className="size-24 rounded-control object-cover"
          />
        </a>
      )}
      {payment.status === 'submitted' &&
        (rejecting ? (
          <div className="space-y-2">
            <label htmlFor={`reason-${payment.id}`} className="block text-sm font-medium">
              {t('rejectReason')}
            </label>
            <TextInput
              id={`reason-${payment.id}`}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              type="button"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void decide('reject')}
              className={buttonClasses('danger', 'w-full')}
            >
              {t('rejectSubmit')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(true)}
              className={buttonClasses('danger')}
            >
              {t('reject')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide('verify')}
              className={buttonClasses('primary')}
            >
              {t('verify')}
            </button>
          </div>
        ))}
      {error && <Alert tone="error">{error}</Alert>}
    </Card>
  );
}
