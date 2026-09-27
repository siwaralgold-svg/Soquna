'use client';

import type { OrderDetail } from '@souqna/contracts';
import { IDEMPOTENCY_HEADER, REALTIME_EVENTS, type OrderAction } from '@souqna/contracts/constants';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ShieldIcon } from '@/components/icons';
import { MoneyBreakdown } from '@/components/money-breakdown';
import { Alert, buttonClasses, Card, TextInput } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from '@/lib/api';
import { compressImage } from '@/lib/compress-image';
import { formatPrice } from '@/lib/format';
import { onRealtime, onReconnect } from '@/lib/realtime';
import { useErrorMessage, useFieldError } from '@/lib/use-error-message';

/** Statuses where things are going fine (green), waiting (amber) or over (grey). */
const TONE: Record<string, string> = {
  funds_held: 'bg-success-50 text-success-700',
  ready_for_pickup: 'bg-success-50 text-success-700',
  delivered: 'bg-success-50 text-success-700',
  completed: 'bg-success-50 text-success-700',
  payout_released: 'bg-success-50 text-success-700',
  cancelled: 'bg-canvas text-ink-muted',
  expired: 'bg-canvas text-ink-muted',
};

export function OrderScreen({ orderId }: { orderId: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<OrderDetail>(`/orders/${orderId}`).then(
      (data) => {
        setOrder(data);
        setError(null);
      },
      (err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'unauthenticated')
          router.replace('/login');
        else setError(errorMessage(err));
      },
    );
  }, [orderId, router, errorMessage]);

  useEffect(() => {
    load();
    const stop = [
      onRealtime(REALTIME_EVENTS.orderUpdated, (e) => e.orderId === orderId && load()),
      onReconnect(load),
    ];
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop.forEach((fn) => fn());
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [orderId, load]);

  if (!order)
    return error ? (
      <Alert tone="error">{error}</Alert>
    ) : (
      <p className="text-ink-muted">{t('common.loading')}</p>
    );

  const infoKey = `orderInfo.${order.status}_${order.role}`;
  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  const deadline =
    ['created', 'awaiting_payment', 'payment_rejected'].includes(order.status) &&
    order.deadlines.paymentDueAt
      ? t('orders.deadlinePay', { time: when(order.deadlines.paymentDueAt) })
      : ['funds_held', 'ready_for_pickup'].includes(order.status) && order.deadlines.handoverDueAt
        ? t('orders.deadlineHandover', { time: when(order.deadlines.handoverDueAt) })
        : order.status === 'delivered' && order.deadlines.inspectionEndsAt
          ? t('orders.deadlineInspection', { time: when(order.deadlines.inspectionEndsAt) })
          : order.status === 'completed' &&
              order.role === 'seller' &&
              order.deadlines.payoutHoldUntil
            ? t('orders.deadlinePayout', { time: when(order.deadlines.payoutHoldUntil) })
            : null;

  return (
    <div className="space-y-4">
      <Link
        href={order.role === 'buyer' ? '/orders' : '/orders?role=selling'}
        className="text-sm text-brand-700"
      >
        {t('orders.back')}
      </Link>

      <header className="space-y-2">
        <p className="text-sm text-ink-muted">{t('orders.code', { code: order.code })}</p>
        <h1 className="text-xl font-bold leading-snug">{order.listing.title}</h1>
        <p
          data-testid="order-status"
          className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${TONE[order.status] ?? 'bg-accent-100 text-accent-700'}`}
        >
          {t(`orderStatus.${order.status}`)}
        </p>
      </header>

      <Card className="space-y-2">
        {t.has(infoKey as never) && (
          <p className="flex gap-2">
            <ShieldIcon width={20} height={20} className="mt-0.5 shrink-0 text-brand-700" />
            {t(infoKey as never)}
          </p>
        )}
        {deadline && <p className="text-sm font-medium text-accent-700">{deadline}</p>}
        {order.refundMinor && (
          <p className="text-sm">
            {t('orders.refunded', { amount: formatPrice(order.refundMinor, locale) })}
          </p>
        )}
      </Card>

      {order.canPay && <PaymentPanel order={order} onPaid={setOrder} />}

      {order.actions.length > 0 && <Actions order={order} onDone={setOrder} />}

      <Card>
        <h2 className="mb-2 font-semibold">{t('orders.amounts')}</h2>
        <MoneyBreakdown amounts={order.amounts} />
      </Card>

      <div className="grid grid-cols-2 gap-2">
        {order.conversationId && (
          <Link
            href={`/chats/${order.conversationId}`}
            className={buttonClasses('secondary', 'text-sm')}
          >
            {t('orders.openChat')}
          </Link>
        )}
        <Link
          href={`/listings/${order.listing.id}`}
          className={buttonClasses('secondary', 'text-sm')}
        >
          {t('orders.viewListing')}
        </Link>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">{t('orders.timeline')}</h2>
        <ol className="space-y-3 border-s-2 border-line ps-4">
          {order.timeline.map((e) => (
            <li key={e.id} className="relative">
              <span
                aria-hidden
                className="absolute -start-[1.4rem] top-1.5 size-3 rounded-full bg-brand-600"
              />
              <p className="font-medium">{t(`orderStatus.${e.status}`)}</p>
              <p className="text-xs text-ink-muted">
                {t(`orders.by_${e.by}`)} · <time dateTime={e.at}>{when(e.at)}</time>
              </p>
              {e.reason && e.reason !== 'deadline' && <p className="text-sm">{e.reason}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

/** Bank transfer instructions and the "I've paid" form (or the test-payment button). */
function PaymentPanel({ order, onPaid }: { order: OrderDetail; onPaid: (o: OrderDetail) => void }) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const fieldError = useFieldError();
  const [reference, setReference] = useState('');
  const [proofId, setProofId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refError, setRefError] = useState<string | undefined>();
  const key = useRef(crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const { instructions, latest } = order.payment;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setRefError(undefined);
    try {
      const body =
        order.paymentMethod === 'mock' ? {} : { reference, ...(proofId ? { proofId } : {}) };
      onPaid(
        await api<OrderDetail>(`/orders/${order.id}/payments`, {
          json: body,
          headers: { [IDEMPOTENCY_HEADER]: key.current },
        }),
      );
    } catch (err) {
      if (err instanceof ApiRequestError && err.status < 500 && err.status >= 400) {
        key.current = crypto.randomUUID();
        if (err.fields.reference) setRefError(fieldError(err.fields.reference));
      }
      if (!(err instanceof ApiRequestError && err.fields.reference)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', await compressImage(file), 'proof');
      setProofId((await api<{ id: string }>('/payment-proofs', { body })).id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  if (order.paymentMethod === 'mock') {
    return (
      <Card className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className={buttonClasses('primary', 'w-full')}
        >
          {t('payMock')}
        </button>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">{t('payTitle')}</h2>
      {latest?.status === 'rejected' && latest.rejectionReason && (
        <Alert tone="error">{t('paymentRejected', { reason: latest.rejectionReason })}</Alert>
      )}
      {instructions && (
        <div className="space-y-2 text-sm">
          <p>{t('payStep1')}</p>
          <p className="text-2xl font-bold text-brand-700" data-testid="pay-amount">
            {formatPrice(instructions.amountMinor, locale)}
          </p>
          <p>{t('payStep2')}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-control bg-canvas p-3">
            <dt className="text-ink-muted">{t('bank')}</dt>
            <dd>{instructions.bankName}</dd>
            <dt className="text-ink-muted">{t('accountName')}</dt>
            <dd>{instructions.accountName}</dd>
            <dt className="text-ink-muted">{t('accountNumber')}</dt>
            <dd className="flex items-center gap-2">
              <bdi dir="ltr" className="font-mono">
                {instructions.accountNumber}
              </bdi>
              <CopyButton value={instructions.accountNumber} />
            </dd>
          </dl>
          <p>{t('payStep3')}</p>
          <p className="flex items-center gap-2">
            <bdi dir="ltr" className="rounded bg-canvas px-2 py-1 font-mono text-lg font-bold">
              {instructions.note}
            </bdi>
            <CopyButton value={instructions.note} />
          </p>
        </div>
      )}
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="reference" className="block font-medium">
            {t('reference')}
          </label>
          <TextInput
            id="reference"
            dir="ltr"
            autoComplete="off"
            inputMode="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            aria-invalid={refError ? true : undefined}
            aria-describedby={refError ? 'reference-error' : undefined}
            required
          />
          {refError && (
            <p id="reference-error" className="text-sm text-danger-600">
              {refError}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <p id="proof-label" className="font-medium">
            {t('proof')}
          </p>
          <input
            ref={fileInput}
            id="proof"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-labelledby="proof-label"
            onChange={(e) => void attach(e.target.files?.[0])}
          />
          <button
            type="button"
            disabled={uploading}
            aria-describedby="proof-label"
            onClick={() => fileInput.current?.click()}
            className={buttonClasses('secondary', 'w-full text-sm')}
          >
            {proofId ? t('proofAttached') : t('proofChoose')}
          </button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <button
          type="submit"
          disabled={busy || uploading || !reference.trim()}
          className={buttonClasses('primary', 'w-full')}
        >
          {busy ? t('submittingPayment') : t('submitPayment')}
        </button>
        {order.payment.submissionsLeft < 3 && (
          <p className="text-xs text-ink-muted">
            {t('attemptsLeft', { n: order.payment.submissionsLeft })}
          </p>
        )}
      </form>
    </Card>
  );
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations('orders');
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className="min-h-8 rounded px-2 text-xs font-semibold text-brand-700 underline"
    >
      {copied ? t('copied') : t('copy')}
    </button>
  );
}

/** Order buttons. Cancelling and confirming receipt ask "are you sure?" first. */
function Actions({ order, onDone }: { order: OrderDetail; onDone: (o: OrderDetail) => void }) {
  const t = useTranslations('orders');
  const errorMessage = useErrorMessage();
  const [confirming, setConfirming] = useState<OrderAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: OrderAction) {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api<OrderDetail>(`/orders/${order.id}/actions`, {
          json: {
            action,
            ...(action === 'cancel' && reason.trim() ? { reason: reason.trim() } : {}),
          },
          headers: { [IDEMPOTENCY_HEADER]: crypto.randomUUID() },
        }),
      );
      setConfirming(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const needsConfirm = (a: OrderAction) => a === 'cancel' || a === 'confirm_received';
  const primary = order.actions.filter((a) => a !== 'cancel');

  return (
    <div className="space-y-2">
      {confirming ? (
        <Card className="space-y-3">
          <p className="font-medium">
            {t(confirming === 'cancel' ? 'confirmCancel' : 'confirmReceived')}
          </p>
          {confirming === 'cancel' && (
            <div className="space-y-1.5">
              <label htmlFor="cancel-reason" className="block text-sm">
                {t('cancelReason')}
              </label>
              <TextInput
                id="cancel-reason"
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className={buttonClasses('secondary')}
            >
              {t('no')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(confirming)}
              className={buttonClasses(confirming === 'cancel' ? 'danger' : 'primary')}
            >
              {t('yes')}
            </button>
          </div>
        </Card>
      ) : (
        <>
          {primary.map((a) => (
            <button
              key={a}
              type="button"
              disabled={busy}
              onClick={() => (needsConfirm(a) ? setConfirming(a) : void run(a))}
              className={buttonClasses('primary', 'w-full')}
            >
              {t(`action_${a}`)}
            </button>
          ))}
          {order.actions.includes('cancel') && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming('cancel')}
              className={buttonClasses('danger', 'w-full')}
            >
              {t('action_cancel')}
            </button>
          )}
        </>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
