'use client';

import type { SessionSummary } from '@souqna/contracts';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';
import { Alert, Button } from './ui';

export function DeviceList() {
  const t = useTranslations('account');
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<SessionSummary[]>('/auth/sessions').then(setSessions, (err: unknown) =>
        setError(errorMessage(err)),
      ),
    [errorMessage],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function signOut(session: SessionSummary) {
    try {
      await api(`/auth/sessions/${session.id}`, { method: 'DELETE' });
      if (session.current) router.replace('/');
      else await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function signOutOthers() {
    try {
      await api('/auth/sessions/revoke-others', { method: 'POST' });
      setNotice(t('signedOutOthers'));
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                <bdi>{s.deviceLabel || t('unknownDevice')}</bdi>
                {s.current && (
                  <span className="ms-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">
                    {t('thisDevice')}
                  </span>
                )}
              </p>
              <p className="text-sm text-ink-muted">
                {t('lastSeen', {
                  date: format.dateTime(new Date(s.lastSeenAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })}
              </p>
            </div>
            {!s.current && (
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                onClick={() => void signOut(s)}
              >
                {t('signOutDevice')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {sessions.length > 1 && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => void signOutOthers()}
        >
          {t('signOutOthers')}
        </Button>
      )}
    </div>
  );
}
