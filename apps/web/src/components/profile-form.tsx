'use client';

import type { CitiesResponse, MeResponse } from '@souqna/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '@/lib/api';
import { useErrorMessage, useFieldError } from '@/lib/use-error-message';
import { Alert, Button, describedBy, Field, Select, TextInput } from './ui';

export function ProfileForm({
  me,
  submitLabel,
  onSaved,
}: {
  me: MeResponse;
  submitLabel: string;
  onSaved: (me: MeResponse) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const fieldError = useFieldError();

  const [cities, setCities] = useState<CitiesResponse>([]);
  const [displayName, setDisplayName] = useState(me.displayName ?? '');
  const [cityId, setCityId] = useState(me.city?.id ?? '');
  const [neighbourhoodId, setNeighbourhoodId] = useState(me.neighbourhood?.id ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CitiesResponse>('/cities').then(setCities, (err: unknown) => setError(errorMessage(err)));
  }, [errorMessage]);

  const name = (item: { nameAr: string; nameEn: string }) =>
    locale === 'ar' ? item.nameAr : item.nameEn;
  const neighbourhoods = cities.find((c) => c.id === cityId)?.neighbourhoods ?? [];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const missing: Record<string, string> = {};
    if (!displayName.trim()) missing.displayName = 'required';
    if (!cityId) missing.cityId = 'required';
    setFields(missing);
    if (Object.keys(missing).length) return;

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api<MeResponse>('/me', {
        method: 'PATCH',
        json: { displayName, cityId, neighbourhoodId: neighbourhoodId || null },
      });
      setSaved(true);
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'validation_failed') setFields(err.fields);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const nameError = fieldError(fields.displayName);
  const cityError = fieldError(fields.cityId);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field
        id="displayName"
        label={t('onboarding.displayNameLabel')}
        hint={t('onboarding.displayNameHint')}
        error={nameError}
      >
        <TextInput
          id="displayName"
          name="displayName"
          autoComplete="nickname"
          maxLength={40}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          aria-invalid={Boolean(nameError)}
          aria-describedby={describedBy('displayName', nameError, t('onboarding.displayNameHint'))}
        />
      </Field>

      <Field id="city" label={t('onboarding.cityLabel')} error={cityError}>
        <Select
          id="city"
          name="city"
          value={cityId}
          onChange={(e) => {
            setCityId(e.target.value);
            setNeighbourhoodId('');
          }}
          aria-invalid={Boolean(cityError)}
          aria-describedby={describedBy('city', cityError)}
        >
          <option value="">{t('onboarding.cityPlaceholder')}</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {name(c)}
            </option>
          ))}
        </Select>
      </Field>

      {neighbourhoods.length > 0 && (
        <Field id="neighbourhood" label={t('onboarding.neighbourhoodLabel')}>
          <Select
            id="neighbourhood"
            name="neighbourhood"
            value={neighbourhoodId}
            onChange={(e) => setNeighbourhoodId(e.target.value)}
          >
            <option value="">{t('onboarding.neighbourhoodPlaceholder')}</option>
            {neighbourhoods.map((n) => (
              <option key={n.id} value={n.id}>
                {name(n)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">{t('common.saved')}</Alert>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t('common.saving') : submitLabel}
      </Button>
    </form>
  );
}
