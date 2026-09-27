import type { ListingCard as Card } from '@souqna/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatPrice, localName, photoSrcSet, photoUrl } from '@/lib/format';

export function ListingCard({
  listing,
  showStatus = false,
}: {
  listing: Card;
  showStatus?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const badge =
    showStatus || listing.status === 'sold' || listing.status === 'reserved'
      ? t(`status.${listing.status}`)
      : null;

  return (
    <Link
      href={`/listings/${listing.id}`}
      className="block overflow-hidden rounded-card border border-line bg-surface"
    >
      <div className="relative aspect-square bg-canvas">
        {listing.coverPhotoId ? (
          // eslint-disable-next-line @next/next/no-img-element -- already-sized WebP from our API
          <img
            src={photoUrl(listing.coverPhotoId, 320)}
            srcSet={photoSrcSet(listing.coverPhotoId)}
            sizes="(max-width: 640px) 50vw, 280px"
            alt=""
            width={320}
            height={320}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-sm text-ink-muted">
            {t('listing.noPhoto')}
          </span>
        )}
        {badge && (
          <span className="absolute start-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-xs text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="space-y-0.5 p-2.5">
        <p className="font-bold text-brand-700">{formatPrice(listing.priceMinor, locale)}</p>
        <p className="line-clamp-2 text-sm leading-snug">{listing.title}</p>
        <p className="text-xs text-ink-muted">{localName(listing.city, locale)}</p>
      </div>
    </Link>
  );
}

export function ListingGrid({ items, showStatus }: { items: Card[]; showStatus?: boolean }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <li key={item.id}>
          <ListingCard listing={item} showStatus={showStatus} />
        </li>
      ))}
    </ul>
  );
}
