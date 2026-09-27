'use client';

import type { ChatMessage, ConversationSummary, MessagesPage } from '@souqna/contracts';
import { IDEMPOTENCY_HEADER, REALTIME_EVENTS, type OfferAction } from '@souqna/contracts/constants';
import { effectiveOfferStatus } from '@souqna/domain';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ShieldIcon } from '@/components/icons';
import { Alert, buttonClasses } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from '@/lib/api';
import {
  mergeMessages,
  newLocalId,
  outboxKey,
  type Outgoing,
  toStored,
  type StoredOutgoing,
} from '@/lib/chat';
import { compressImage } from '@/lib/compress-image';
import { deleteDraft, loadDraft, saveDraft } from '@/lib/draft-store';
import { formatPrice, photoUrl } from '@/lib/format';
import { isRealtimeConnected, onRealtime, onReconnect } from '@/lib/realtime';
import { notifyUnreadChanged } from '@/lib/unread';
import { useErrorMessage } from '@/lib/use-error-message';
import { Composer } from './composer';
import { MessageItem } from './message-item';

/** How often to check for new messages when the live connection is down. */
const POLL_MS = 15_000;

type Scroll = { to: 'bottom' } | { to: 'keep'; height: number; y: number } | null;

/** Errors worth retrying with the same idempotency key; anything else is a final "no". */
function isTransient(err: unknown): boolean {
  if (!(err instanceof ApiRequestError)) return true;
  return (
    err.code === 'network' ||
    err.code === 'idempotency_conflict' ||
    err.status === 429 ||
    err.status >= 500
  );
}

const nearBottom = () =>
  window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;

export function ChatScreen({
  conversationId,
  startWithOffer,
}: {
  conversationId: string;
  startWithOffer: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();

  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyOffer, setBusyOffer] = useState<string | null>(null);

  // The refs are the source of truth for async code (callbacks see the latest values
  // straight away); the state copies drive rendering.
  const summaryRef = useRef<ConversationSummary | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const outboxRef = useRef<Outgoing[]>([]);
  const outboxRestored = useRef(false);
  const scroll = useRef<Scroll>(null);
  const base = `/conversations/${conversationId}`;

  const applySummary = useCallback((next: ConversationSummary) => {
    summaryRef.current = next;
    setSummary(next);
  }, []);

  const updateMessages = useCallback((incoming: ChatMessage[], stick = nearBottom()) => {
    if (stick) scroll.current = { to: 'bottom' };
    messagesRef.current = mergeMessages(messagesRef.current, incoming);
    setMessages(messagesRef.current);
  }, []);

  const updateOutbox = useCallback((fn: (items: Outgoing[]) => Outgoing[]) => {
    outboxRef.current = fn(outboxRef.current);
    setOutbox(outboxRef.current);
  }, []);

  const markRead = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    api(`${base}/read`, { method: 'POST' }).then(notifyUnreadChanged, () => {});
  }, [base]);

  const handleLoadError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiRequestError && err.code === 'unauthenticated')
        router.replace('/login');
      else setLoadError(errorMessage(err));
    },
    [router, errorMessage],
  );

  /** Fetches everything newer than what we have, plus the latest page to refresh offers. */
  const catchUp = useCallback(async () => {
    try {
      const [latest, fresh] = await Promise.all([
        api<MessagesPage>(`${base}/messages`),
        api<ConversationSummary>(base),
      ]);
      applySummary(fresh);
      const items = [...latest.items];
      // If more than a page arrived while we were away, fill the gap in between.
      let cursor = messagesRef.current.at(-1)?.id;
      const oldestLatest = latest.items[0]?.id;
      while (cursor && oldestLatest && BigInt(cursor) < BigInt(oldestLatest)) {
        const page = await api<MessagesPage>(`${base}/messages?after=${cursor}`);
        items.push(...page.items);
        if (!page.hasMore || page.items.length === 0) break;
        cursor = page.items.at(-1)!.id;
      }
      updateMessages(items);
      markRead();
    } catch {
      // Still offline; the next reconnect or poll tries again.
    }
  }, [base, applySummary, updateMessages, markRead]);

  // First load.
  useEffect(() => {
    let active = true;
    Promise.all([api<ConversationSummary>(base), api<MessagesPage>(`${base}/messages`)]).then(
      ([conv, page]) => {
        if (!active) return;
        applySummary(conv);
        setHasMore(page.hasMore);
        updateMessages(page.items, true);
        markRead();
      },
      (err: unknown) => active && handleLoadError(err),
    );
    return () => {
      active = false;
    };
  }, [base, applySummary, updateMessages, markRead, handleLoadError]);

  // Live updates, with polling when the live connection is down.
  useEffect(() => {
    const forThis = (m: ChatMessage) => m.conversationId === conversationId;
    const stop = [
      onRealtime(REALTIME_EVENTS.message, (m) => {
        if (!forThis(m)) return;
        updateMessages([m], nearBottom() || m.senderId !== summaryRef.current?.counterpart.id);
        if (m.senderId === summaryRef.current?.counterpart.id) markRead();
      }),
      onRealtime(REALTIME_EVENTS.messageUpdated, (m) => forThis(m) && updateMessages([m], false)),
      onReconnect(() => void catchUp()),
    ];
    const poll = setInterval(() => {
      if (!isRealtimeConnected() && document.visibilityState === 'visible') void catchUp();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && markRead();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop.forEach((fn) => fn());
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [conversationId, updateMessages, markRead, catchUp]);

  // Keep the view pinned to the newest message, or steady when older ones load above.
  useLayoutEffect(() => {
    const s = scroll.current;
    scroll.current = null;
    if (s?.to === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight });
    else if (s?.to === 'keep')
      window.scrollTo({ top: s.y + document.documentElement.scrollHeight - s.height });
  }, [messages, outbox]);

  // ---- Outbox: messages wait here until the server has them. ----

  const deliver = useCallback(
    async (localId: string) => {
      const item = outboxRef.current.find((o) => o.localId === localId);
      if (!item || item.state === 'sending') return;
      if (!navigator.onLine) {
        updateOutbox((os) =>
          os.map((o) => (o.localId === localId ? { ...o, state: 'waiting' } : o)),
        );
        return;
      }
      const patch = (p: Partial<Outgoing>) =>
        updateOutbox((os) => os.map((o) => (o.localId === localId ? { ...o, ...p } : o)));
      patch({ state: 'sending', error: undefined });
      try {
        let photoId = item.photoId;
        if (item.kind === 'image' && !photoId && item.blob) {
          const body = new FormData();
          body.append('file', item.blob, 'photo');
          photoId = (await api<{ id: string }>('/chat-photos', { body })).id;
          patch({ photoId, blob: undefined });
        }
        const json =
          item.kind === 'text'
            ? { type: 'text', text: item.text }
            : item.kind === 'image'
              ? { type: 'image', photoId }
              : { type: 'offer', amount: item.amount };
        const message = await api<ChatMessage>(`${base}/messages`, {
          json,
          headers: { [IDEMPOTENCY_HEADER]: item.idempotencyKey },
        });
        scroll.current = { to: 'bottom' };
        updateOutbox((os) => os.filter((o) => o.localId !== localId));
        updateMessages([message], true);
        if (item.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview);
      } catch (err) {
        patch(
          isTransient(err)
            ? { state: 'waiting' }
            : {
                state: 'failed',
                error: err instanceof ApiRequestError ? err.code : 'internal_error',
              },
        );
      }
    },
    [base, updateOutbox, updateMessages],
  );

  const retryWaiting = useCallback(() => {
    outboxRef.current.filter((o) => o.state === 'waiting').forEach((o) => void deliver(o.localId));
  }, [deliver]);

  // Restore unsent messages saved on this phone, then keep the saved copy in step.
  useEffect(() => {
    let active = true;
    void loadDraft<StoredOutgoing[]>(outboxKey(conversationId)).then((saved) => {
      if (!active) return;
      outboxRestored.current = true;
      if (!saved?.length) return;
      const restored = saved.map<Outgoing>((o) => ({
        ...o,
        preview: o.blob
          ? URL.createObjectURL(o.blob)
          : o.photoId
            ? photoUrl(o.photoId, 320)
            : undefined,
      }));
      updateOutbox((os) => [...restored, ...os]);
      retryWaiting();
    });
    return () => {
      active = false;
    };
  }, [conversationId, updateOutbox, retryWaiting]);

  useEffect(() => {
    if (!outboxRestored.current) return;
    const key = outboxKey(conversationId);
    if (outbox.length === 0) void deleteDraft(key);
    else void saveDraft(key, outbox.map(toStored));
  }, [outbox, conversationId]);

  // Retry when the phone gets its connection back, and every so often while waiting.
  useEffect(() => {
    window.addEventListener('online', retryWaiting);
    const stopReconnect = onReconnect(retryWaiting);
    const timer = setInterval(retryWaiting, POLL_MS);
    return () => {
      window.removeEventListener('online', retryWaiting);
      stopReconnect();
      clearInterval(timer);
    };
  }, [retryWaiting]);

  function enqueue(item: Omit<Outgoing, 'localId' | 'idempotencyKey' | 'state'>) {
    const localId = newLocalId();
    scroll.current = { to: 'bottom' };
    updateOutbox((os) => [
      ...os,
      { ...item, localId, idempotencyKey: crypto.randomUUID(), state: 'waiting' },
    ]);
    void deliver(localId);
  }

  async function sendPhoto(file: File) {
    const blob = await compressImage(file);
    enqueue({ kind: 'image', blob, preview: URL.createObjectURL(blob) });
  }

  function discard(localId: string) {
    const item = outboxRef.current.find((o) => o.localId === localId);
    if (item?.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview);
    updateOutbox((os) => os.filter((o) => o.localId !== localId));
  }

  async function actOnOffer(offerId: string, action: OfferAction) {
    setBusyOffer(offerId);
    setActionError(null);
    try {
      updateMessages(
        [await api<ChatMessage>(`${base}/offers/${offerId}/actions`, { json: { action } })],
        false,
      );
    } catch (err) {
      setActionError(errorMessage(err));
      void catchUp();
    } finally {
      setBusyOffer(null);
    }
  }

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    try {
      const page = await api<MessagesPage>(`${base}/messages?before=${first.id}`);
      scroll.current = {
        to: 'keep',
        height: document.documentElement.scrollHeight,
        y: window.scrollY,
      };
      setHasMore(page.hasMore);
      updateMessages(page.items, false);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  if (loadError) return <Alert tone="error">{loadError}</Alert>;
  if (!summary) return <p className="text-ink-muted">{t('common.loading')}</p>;

  const { listing, counterpart, role } = summary;
  const now = new Date();
  const listingGone = listing.status === 'removed' || listing.status === 'deleted';
  const pendingOffer =
    messages.some(
      (m) =>
        m.offer &&
        effectiveOfferStatus(m.offer.status, new Date(m.offer.expiresAt), now) === 'pending',
    ) || outbox.some((o) => o.kind === 'offer' && o.state !== 'failed');
  const canOffer =
    role === 'buyer' && listing.status === 'active' && listing.negotiable && !pendingOffer;

  const dayOf = (m: ChatMessage) =>
    format.dateTime(new Date(m.createdAt), { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="-mb-28 flex min-h-[calc(100dvh-4.5rem)] flex-col">
      <header className="sticky top-14 z-10 -mx-4 -mt-4 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link
            href="/chats"
            aria-label={t('common.back')}
            className="-ms-2 flex size-11 items-center justify-center rounded-full text-xl hover:bg-canvas rtl:-scale-x-100"
          >
            ←
          </Link>
          {listing.coverPhotoId && (
            // eslint-disable-next-line @next/next/no-img-element -- small WebP from our API
            <img
              src={photoUrl(listing.coverPhotoId, 320)}
              alt=""
              width={44}
              height={44}
              className="size-11 shrink-0 rounded-control bg-canvas object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold">{counterpart.displayName}</h1>
            <Link
              href={`/listings/${listing.id}`}
              className="block truncate text-sm text-ink-muted underline-offset-2 hover:underline"
            >
              {listing.title} · {formatPrice(listing.priceMinor, locale)}
              {listing.status !== 'active' && ` · ${t(`status.${listing.status}`)}`}
            </Link>
          </div>
        </div>
      </header>

      <section
        aria-labelledby="chat-safety"
        className="mt-3 rounded-card border border-brand-200 bg-brand-50 p-3 text-sm"
      >
        <h2 id="chat-safety" className="flex items-center gap-2 font-semibold text-brand-800">
          <ShieldIcon width={18} height={18} />
          {t('chat.safetyTitle')}
        </h2>
        {messages.length === 0 ? (
          <ul className="mt-1 list-disc space-y-1 ps-5">
            <li>{t('chat.safety1')}</li>
            <li>{t('chat.safety2')}</li>
            <li>{t('chat.safety3')}</li>
          </ul>
        ) : (
          <p className="mt-1">{t('chat.safety1')}</p>
        )}
      </section>

      {hasMore && (
        <button
          type="button"
          onClick={() => void loadOlder()}
          className={buttonClasses('secondary', 'mx-auto mt-3 min-h-10 text-sm')}
        >
          {t('chat.loadOlder')}
        </button>
      )}

      <ol aria-label={t('chat.title')} className="mt-3 flex-1 space-y-2">
        {messages.map((m, i) => {
          const day = dayOf(m);
          const separator = i === 0 || dayOf(messages[i - 1]!) !== day;
          return (
            <MessageRow key={m.id} day={separator ? day : null}>
              <MessageItem
                message={m}
                mine={m.senderId !== counterpart.id}
                role={role}
                busy={busyOffer === m.offer?.id}
                listingId={listing.id}
                listingActive={listing.status === 'active'}
                onOfferAction={(offerId, action) => void actOnOffer(offerId, action)}
              />
            </MessageRow>
          );
        })}
        {outbox.map((o) => (
          <li key={o.localId} data-testid="outgoing" className="space-y-1">
            <div className="ms-auto max-w-[80%] rounded-2xl rounded-ee-sm bg-brand-600/70 px-3 py-2 text-white">
              {o.kind === 'image' && o.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview of the photo being sent
                <img
                  src={o.preview}
                  alt={t('chat.photoAlt')}
                  width={224}
                  height={224}
                  className="aspect-square w-56 max-w-full rounded-xl object-cover"
                />
              ) : o.kind === 'offer' ? (
                <p className="font-semibold">
                  {t('chat.offerTitle')}: {o.amount}
                </p>
              ) : (
                <p className="whitespace-pre-line break-words">{o.text}</p>
              )}
            </div>
            <p
              role={o.state === 'failed' ? 'alert' : 'status'}
              className={`flex items-center justify-end gap-2 text-xs ${o.state === 'failed' ? 'text-danger-600' : 'text-ink-muted'}`}
            >
              {o.state === 'failed'
                ? t('chat.failed', { reason: t(`errors.${o.error ?? 'internal_error'}` as never) })
                : t(o.state === 'waiting' ? 'chat.waiting' : 'chat.sending')}
              {o.state !== 'sending' && (
                <button
                  type="button"
                  onClick={() => discard(o.localId)}
                  className="min-h-8 rounded px-2 font-semibold underline"
                >
                  {t('chat.delete')}
                </button>
              )}
            </p>
          </li>
        ))}
      </ol>

      {actionError && (
        <div className="mt-2">
          <Alert tone="error">{actionError}</Alert>
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 mt-3 border-t border-line bg-surface px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        {listingGone ? (
          <p className="py-2 text-center text-sm text-ink-muted">{t('chat.listingGone')}</p>
        ) : (
          <Composer
            canOffer={canOffer}
            startWithOffer={startWithOffer}
            priceMinor={listing.priceMinor}
            onText={(text) => enqueue({ kind: 'text', text })}
            onPhoto={(file) => void sendPhoto(file)}
            onOffer={(amount) => enqueue({ kind: 'offer', amount })}
          />
        )}
      </div>
    </div>
  );
}

function MessageRow({ day, children }: { day: string | null; children: ReactNode }) {
  return (
    <>
      {day && (
        <li aria-hidden className="py-1 text-center text-xs text-ink-muted">
          {day}
        </li>
      )}
      {children}
    </>
  );
}
