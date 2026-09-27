'use client';

import { CHAT_TEXT_MAX } from '@souqna/contracts/constants';
import { containsContactInfo, parsePriceInput } from '@souqna/domain';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { CameraIcon, SendIcon, TagIcon } from '@/components/icons';
import { buttonClasses, TextInput } from '@/components/ui';
import { formatPrice } from '@/lib/format';

/**
 * The message box pinned to the bottom of a chat. Sending never waits for the network:
 * each message goes into the outbox straight away and is delivered from there.
 */
export function Composer({
  canOffer,
  startWithOffer,
  priceMinor,
  onText,
  onPhoto,
  onOffer,
}: {
  canOffer: boolean;
  startWithOffer: boolean;
  priceMinor: string;
  onText: (text: string) => void;
  onPhoto: (file: File) => void;
  onOffer: (amount: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [text, setText] = useState('');
  const [offerOpen, setOfferOpen] = useState(startWithOffer);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const showOffer = canOffer && offerOpen;

  function submitText(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    onText(value);
    setText('');
  }

  function submitOffer(e: FormEvent) {
    e.preventDefault();
    const minor = parsePriceInput(amount);
    if (minor === null) return setAmountError(t('validation.invalid_price'));
    if (minor > BigInt(priceMinor)) return setAmountError(t('chat.offerTooHigh'));
    onOffer(amount);
    setAmount('');
    setAmountError(null);
    setOfferOpen(false);
  }

  return (
    <div className="space-y-2">
      {showOffer && (
        <form
          onSubmit={submitOffer}
          noValidate
          className="space-y-1.5 rounded-card border border-brand-200 bg-brand-50 p-3"
        >
          <label htmlFor="offer-amount" className="block text-sm font-medium">
            {t('chat.offerAmount')}
          </label>
          <div className="flex gap-2">
            <TextInput
              id="offer-amount"
              inputMode="decimal"
              autoComplete="off"
              dir="ltr"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={amountError ? true : undefined}
              aria-describedby="offer-amount-hint"
              className="flex-1"
            />
            <button type="submit" className={buttonClasses('primary', 'shrink-0 px-4')}>
              {t('chat.sendOffer')}
            </button>
          </div>
          <p
            id="offer-amount-hint"
            className={`text-xs ${amountError ? 'text-danger-600' : 'text-ink-muted'}`}
          >
            {amountError ?? t('chat.offerHint', { price: formatPrice(priceMinor, locale) })}
          </p>
        </form>
      )}

      {containsContactInfo(text) && (
        <p role="status" className="text-xs text-accent-700">
          {t('chat.contactHint')}
        </p>
      )}

      <form onSubmit={submitText} className="flex items-end gap-1.5">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          id="chat-photo"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPhoto(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          aria-label={t('chat.attachPhoto')}
          className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-canvas"
        >
          <CameraIcon />
        </button>
        {canOffer && (
          <button
            type="button"
            onClick={() => setOfferOpen((o) => !o)}
            aria-expanded={showOffer}
            aria-label={t('chat.makeOffer')}
            className={`flex size-12 shrink-0 items-center justify-center rounded-full hover:bg-canvas ${
              showOffer ? 'text-brand-700' : 'text-ink-muted'
            }`}
          >
            <TagIcon />
          </button>
        )}
        <label htmlFor="chat-text" className="sr-only">
          {t('chat.messageLabel')}
        </label>
        <textarea
          id="chat-text"
          rows={1}
          maxLength={CHAT_TEXT_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('chat.placeholder')}
          className="field-sizing-content max-h-32 min-h-12 flex-1 resize-none rounded-3xl border border-line bg-surface px-4 py-3 text-base"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label={t('chat.send')}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white disabled:bg-brand-200"
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
