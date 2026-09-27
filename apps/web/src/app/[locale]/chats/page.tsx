'use client';

import type { ConversationSummary } from '@souqna/contracts';
import { REALTIME_EVENTS } from '@souqna/contracts/constants';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from '@/lib/api';
import { photoUrl } from '@/lib/format';
import { onRealtime, onReconnect } from '@/lib/realtime';
import { useErrorMessage } from '@/lib/use-error-message';

export default function ChatsPage() {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ConversationSummary[]>('/conversations').then(
      (data) => {
        setItems(data);
        setError(null);
      },
      (err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'unauthenticated')
          router.replace('/login');
        else setError(errorMessage(err));
      },
    );
  }, [router, errorMessage]);

  useEffect(() => {
    load();
    const stop = [onRealtime(REALTIME_EVENTS.message, load), onReconnect(load)];
    return () => stop.forEach((fn) => fn());
  }, [load]);

  function preview(c: ConversationSummary): string {
    const last = c.lastMessage;
    if (!last) return t('chat.noMessages');
    const text =
      last.type === 'image'
        ? t('chat.photo')
        : last.type === 'offer'
          ? t('chat.offerPreview')
          : (last.text ?? '');
    return last.senderId === c.counterpart.id ? text : t('chat.you', { text });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('chat.title')}</h1>
      {error && <Alert tone="error">{error}</Alert>}
      {items === null ? (
        !error && <p className="text-ink-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="rounded-card border border-dashed border-line p-6 text-center text-ink-muted">
          {t('chat.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {items.map((c) => (
            <li key={c.id}>
              <Link href={`/chats/${c.id}`} className="flex items-center gap-3 p-3 hover:bg-canvas">
                {c.listing.coverPhotoId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small WebP from our API
                  <img
                    src={photoUrl(c.listing.coverPhotoId, 320)}
                    alt=""
                    width={56}
                    height={56}
                    loading="lazy"
                    className="size-14 shrink-0 rounded-control bg-canvas object-cover"
                  />
                ) : (
                  <span aria-hidden className="size-14 shrink-0 rounded-control bg-canvas" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate font-semibold">{c.counterpart.displayName}</p>
                    <time dateTime={c.lastMessageAt} className="shrink-0 text-xs text-ink-muted">
                      {format.relativeTime(new Date(c.lastMessageAt), new Date())}
                    </time>
                  </div>
                  <p className="truncate text-sm text-ink-muted">
                    <span className="me-1 rounded bg-canvas px-1 text-xs">
                      {t(c.role === 'buyer' ? 'chat.buying' : 'chat.selling')}
                    </span>
                    {c.listing.title}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`truncate text-sm ${c.unread > 0 ? 'font-semibold text-ink' : 'text-ink-muted'}`}
                    >
                      {preview(c)}
                    </p>
                    {c.unread > 0 && (
                      <span className="shrink-0 rounded-full bg-brand-600 px-2 text-xs font-bold leading-5 text-white">
                        <span aria-hidden>{format.number(c.unread)}</span>
                        <span className="sr-only">{t('chat.unread', { count: c.unread })}</span>
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
