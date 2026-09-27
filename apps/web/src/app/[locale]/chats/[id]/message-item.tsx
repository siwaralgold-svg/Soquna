'use client';

import type { ChatMessage } from '@souqna/contracts';
import type { OfferAction } from '@souqna/contracts/constants';
import { effectiveOfferStatus } from '@souqna/domain';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { ShieldIcon, TagIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui';
import { formatPrice, photoUrl } from '@/lib/format';

const bubble = (mine: boolean) =>
  `max-w-[80%] rounded-2xl px-3 py-2 ${
    mine
      ? 'ms-auto rounded-ee-sm bg-brand-600 text-white'
      : 'me-auto rounded-es-sm bg-surface border border-line'
  }`;

export function MessageItem({
  message,
  mine,
  role,
  busy,
  onOfferAction,
}: {
  message: ChatMessage;
  mine: boolean;
  role: 'buyer' | 'seller';
  busy: boolean;
  onOfferAction: (offerId: string, action: OfferAction) => void;
}) {
  const t = useTranslations('chat');
  const format = useFormatter();
  const time = format.dateTime(new Date(message.createdAt), { hour: 'numeric', minute: '2-digit' });

  return (
    <li data-testid="message" className="space-y-1">
      {message.type === 'offer' && message.offer ? (
        <OfferCard
          offer={message.offer}
          mine={mine}
          role={role}
          busy={busy}
          time={time}
          onAction={(action) => onOfferAction(message.offer!.id, action)}
        />
      ) : (
        <div className={bubble(mine)}>
          {message.type === 'image' && message.photoId ? (
            <a href={photoUrl(message.photoId, 1280)} target="_blank" rel="noopener">
              {/* eslint-disable-next-line @next/next/no-img-element -- already-sized WebP from our API */}
              <img
                src={photoUrl(message.photoId, 320)}
                alt={t('photoAlt')}
                title={t('openPhoto')}
                width={224}
                height={224}
                loading="lazy"
                className="aspect-square w-56 max-w-full rounded-xl bg-canvas object-cover"
              />
            </a>
          ) : (
            <p className="whitespace-pre-line break-words">{message.text}</p>
          )}
          <p className={`mt-0.5 text-end text-[11px] ${mine ? 'text-white/80' : 'text-ink-muted'}`}>
            <time dateTime={message.createdAt}>{time}</time>
          </p>
        </div>
      )}
      {message.flags.map((flag) => (
        <p
          key={flag}
          role="note"
          className="mx-auto flex max-w-[90%] items-start gap-2 rounded-control bg-accent-100 px-3 py-2 text-xs text-accent-700"
        >
          <ShieldIcon width={16} height={16} className="mt-px shrink-0" />
          {t(flag === 'contact_masked' ? 'maskedNote' : 'offPlatformNote')}
        </p>
      ))}
    </li>
  );
}

function OfferCard({
  offer,
  mine,
  role,
  busy,
  time,
  onAction,
}: {
  offer: NonNullable<ChatMessage['offer']>;
  mine: boolean;
  role: 'buyer' | 'seller';
  busy: boolean;
  time: string;
  onAction: (action: OfferAction) => void;
}) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const format = useFormatter();
  const now = new Date();
  const expiresAt = new Date(offer.expiresAt);
  const status = effectiveOfferStatus(offer.status, expiresAt, now);
  const tone =
    status === 'accepted'
      ? 'bg-success-50 text-success-700'
      : status === 'pending'
        ? 'bg-brand-50 text-brand-800'
        : 'bg-canvas text-ink-muted';

  return (
    <div
      data-testid="offer"
      className={`w-64 max-w-[85%] space-y-2 rounded-2xl border border-brand-200 bg-surface p-3 ${mine ? 'ms-auto' : 'me-auto'}`}
    >
      <p className="flex items-center gap-1.5 text-sm text-ink-muted">
        <TagIcon width={16} height={16} />
        {t('offerTitle')}
      </p>
      <p className="text-xl font-bold text-brand-700">{formatPrice(offer.amountMinor, locale)}</p>
      <p className="flex items-center justify-between gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-medium ${tone}`}>
          {t(`offer_${status}`)}
        </span>
        <span className="text-ink-muted">
          {status === 'pending'
            ? t('offerExpires', { time: format.relativeTime(expiresAt, now) })
            : time}
        </span>
      </p>
      {status === 'accepted' && <p className="text-sm">{t('offerAcceptedNote')}</p>}
      {status === 'pending' && role === 'seller' && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction('decline')}
            className={buttonClasses('secondary', 'min-h-11 px-2')}
          >
            {t('decline')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction('accept')}
            className={buttonClasses('primary', 'min-h-11 px-2')}
          >
            {t('accept')}
          </button>
        </div>
      )}
      {status === 'pending' && role === 'buyer' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction('withdraw')}
          className={buttonClasses('secondary', 'min-h-11 w-full px-2')}
        >
          {t('withdraw')}
        </button>
      )}
    </div>
  );
}
