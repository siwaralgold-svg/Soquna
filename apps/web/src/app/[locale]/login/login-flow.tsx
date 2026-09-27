'use client';

import type { MeResponse, OtpRequestResponse } from '@souqna/contracts';
import { maskPhone, normalizeSudanPhone, toAsciiDigits } from '@souqna/domain';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, describedBy, Field, TextInput } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

type Step = { name: 'phone' } | { name: 'code'; phone: string; challengeId: string };

export function LoginFlow() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();

  const [step, setStep] = useState<Step>({ name: 'phone' });
  const [phoneInput, setPhoneInput] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [resendIn, setResendIn] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);

  // Already logged in? Skip straight to the account page.
  useEffect(() => {
    api<MeResponse>('/me')
      .then((me) => router.replace(me.profileComplete ? '/account' : '/onboarding'))
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function sendCode(phone: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<OtpRequestResponse>('/auth/otp/request', { json: { phone, locale } });
      setStep({ name: 'code', phone, challengeId: res.challengeId });
      setCode('');
      setResendIn(res.resendAfterSeconds);
      if (process.env.NODE_ENV !== 'production') {
        api<{ code: string }>(`/dev/otp?phone=${encodeURIComponent(phone)}`)
          .then((r) => setDevCode(r.code))
          .catch(() => setDevCode(null));
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.retryAfterSeconds)
        setResendIn(err.retryAfterSeconds);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onSubmitPhone(event: FormEvent) {
    event.preventDefault();
    const phone = normalizeSudanPhone(phoneInput);
    if (!phone) {
      setFieldError(t('validation.invalid_phone'));
      return;
    }
    setFieldError(undefined);
    void sendCode(phone);
  }

  async function onSubmitCode(event: FormEvent) {
    event.preventDefault();
    if (step.name !== 'code') return;
    const digits = toAsciiDigits(code).trim();
    if (!/^\d{6}$/.test(digits)) {
      setFieldError(t('validation.invalid_code'));
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    setError(null);
    try {
      await api('/auth/otp/verify', { json: { challengeId: step.challengeId, code: digits } });
      const me = await api<MeResponse>('/me');
      router.replace(me.profileComplete ? '/account' : '/onboarding');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (step.name === 'phone') {
    return (
      <Card>
        <form onSubmit={onSubmitPhone} noValidate className="space-y-4">
          <Field
            id="phone"
            label={t('login.phoneLabel')}
            hint={t('login.phoneHint')}
            error={fieldError}
          >
            <TextInput
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              className="text-start"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={describedBy('phone', fieldError, t('login.phoneHint'))}
              required
            />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t('login.sending') : t('login.sendCode')}
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmitCode} noValidate className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('login.codeTitle')}</h2>
          <p className="text-ink-muted">
            {/* LRI … PDI keeps the number left-to-right inside Arabic text. */}
            {t('login.codeSentTo', {
              phone: `\u2066${maskPhone(step.phone).replaceAll(' ', '\u00a0')}\u2069`,
            })}
          </p>
        </div>
        <Field id="code" label={t('login.codeLabel')} error={fieldError}>
          <TextInput
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            maxLength={6}
            className="text-center text-2xl tracking-[0.5em]"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={describedBy('code', fieldError)}
            autoFocus
            required
          />
        </Field>
        {devCode && (
          <p
            data-testid="dev-otp"
            className="rounded-control bg-accent-100 px-4 py-2 text-sm text-accent-700"
          >
            {/* Development only (mock SMS); never rendered in production builds. */}
            <bdi dir="ltr">{`DEV ${devCode}`}</bdi>
          </p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t('login.verifying') : t('login.verify')}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            className="min-h-11 text-brand-700 underline-offset-4 hover:underline"
            onClick={() => {
              setStep({ name: 'phone' });
              setError(null);
              setDevCode(null);
            }}
          >
            {t('login.changeNumber')}
          </button>
          {resendIn > 0 ? (
            <span className="text-ink-muted">{t('login.resendIn', { seconds: resendIn })}</span>
          ) : (
            <button
              type="button"
              className="min-h-11 text-brand-700 underline-offset-4 hover:underline disabled:text-ink-muted"
              disabled={busy}
              onClick={() => void sendCode(step.phone)}
            >
              {t('login.resend')}
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
