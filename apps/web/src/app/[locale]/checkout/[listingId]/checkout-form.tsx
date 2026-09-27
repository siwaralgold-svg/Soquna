'use client';

import type { CheckoutQuote } from '@souqna/contracts';
import {
  CHECKOUT_DELIVERY_METHODS,
  IDEMPOTENCY_HEADER,
  type CheckoutDeliveryMethod,
} from '@souqna/contracts/constants';
import type { PaymentMethod } from '@souqna/domain';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { ShieldIcon } from '@/components/icons';
import { MoneyBreakdown } from '@/components/money-breakdown';
import { Alert, buttonClasses, Card } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from '@/lib/api';
import { photoUrl } from '@/lib/format';
import { useErrorMessage } from '@/lib/use-error-message';

export function CheckoutForm({
  listingId,
  offerId,
}: {
  listingId: string;
  offerId: string | null;
}) {
  const t = useTranslations('checkout');
  const tc = useTranslations('common');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [delivery, setDelivery] = useState<CheckoutDeliveryMethod>('courier');
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per attempt: a retry after a network error can't create a second order.
  const [key, setKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const params = new URLSearchParams({ listingId, deliveryMethod: delivery });
    if (offerId) params.set('offerId', offerId);
    api<CheckoutQuote>(`/checkout/quote?${params}`).then(
      (q) => {
        setQuote(q);
        setError(null);
        // Keep the choice if still possible, otherwise pick the first one that is.
        setPayment((current) => {
          const ok = q.paymentMethods.filter((m) => !m.refusal).map((m) => m.method);
          return current && ok.includes(current) ? current : (ok[0] ?? null);
        });
      },
      (err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'unauthenticated')
          router.replace('/login');
        else setError(errorMessage(err));
      },
    );
  }, [listingId, offerId, delivery, router, errorMessage]);

  async function place(e: FormEvent) {
    e.preventDefault();
    if (!payment) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>('/orders', {
        json: {
          listingId,
          paymentMethod: payment,
          deliveryMethod: delivery,
          ...(offerId ? { offerId } : {}),
        },
        headers: { [IDEMPOTENCY_HEADER]: key },
      });
      router.replace(`/orders/${id}`);
    } catch (err) {
      setError(errorMessage(err));
      // A definite "no" from the server: the next press is a new attempt.
      if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) {
        setKey(crypto.randomUUID());
      }
      setBusy(false);
    }
  }

  if (!quote) {
    return error ? (
      <Alert tone="error">{error}</Alert>
    ) : (
      <p className="text-ink-muted">{tc('loading')}</p>
    );
  }

  return (
    <form onSubmit={place} className="space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      <Card className="flex items-center gap-3">
        {quote.listing.coverPhotoId && (
          // eslint-disable-next-line @next/next/no-img-element -- small WebP from our API
          <img
            src={photoUrl(quote.listing.coverPhotoId, 320)}
            alt=""
            width={64}
            height={64}
            className="size-16 shrink-0 rounded-control object-cover"
          />
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold">{quote.listing.title}</p>
          <p className="text-sm text-ink-muted">
            {t('seller', { name: quote.listing.sellerName })}
          </p>
        </div>
      </Card>

      <p className="flex gap-2 rounded-card border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">
        <ShieldIcon width={20} height={20} className="shrink-0" />
        {t('how')}
      </p>

      <fieldset className="space-y-2">
        <legend className="mb-2 font-semibold">{t('delivery')}</legend>
        {CHECKOUT_DELIVERY_METHODS.map((m) => (
          <Choice
            key={m}
            name="delivery"
            value={m}
            checked={delivery === m}
            onChange={() => setDelivery(m)}
            label={t(`delivery_${m}`)}
            hint={t(`delivery_${m}_hint`)}
          />
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 font-semibold">{t('payment')}</legend>
        {quote.paymentMethods.map(({ method, refusal }) => (
          <Choice
            key={method}
            name="payment"
            value={method}
            checked={payment === method}
            disabled={refusal !== null}
            onChange={() => setPayment(method)}
            label={t(`payment_${method}`)}
            hint={refusal ? t(`refusal_${refusal}`) : t(`payment_${method}_hint`)}
          />
        ))}
      </fieldset>

      <Card>
        <h2 className="mb-2 font-semibold">{t('summary')}</h2>
        <MoneyBreakdown amounts={quote} agreed={quote.offerId !== null} />
        <p className="mt-3 text-xs text-ink-muted">
          {t('payWithin', { hours: quote.paymentHours })}{' '}
          {t('inspection', { hours: quote.inspectionHours })}
        </p>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      <button
        type="submit"
        disabled={busy || !payment}
        className={buttonClasses('primary', 'w-full')}
      >
        {busy ? t('placing') : t('place')}
      </button>
    </form>
  );
}

function Choice({
  name,
  value,
  checked,
  disabled = false,
  onChange,
  label,
  hint,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-card border p-3 ${
        checked ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1 size-5 accent-brand-600"
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}
