import type { ListingDetail } from '@souqna/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { PinIcon, ShieldIcon } from '@/components/icons';
import { buttonClasses, Card } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { formatPrice, localName, photoSrcSet, photoUrl } from '@/lib/format';
import { serverGet } from '@/lib/server-api';
import { FavouriteButton } from './favourite-button';
import { ReportForm } from './report-form';

type Props = { params: Promise<{ id: string; locale: string }> };

const UUID = /^[0-9a-f-]{36}$/i;

async function load(id: string) {
  if (!UUID.test(id)) return null;
  return serverGet<ListingDetail>(`/listings/${id}`, { withSession: true });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const listing = await load(id);
  return listing ? { title: listing.title } : {};
}

export default async function ListingPage({ params }: Props) {
  const { id } = await params;
  const listing = await load(id);
  if (!listing) notFound();

  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();
  const total = listing.photos.length;

  return (
    <article className="space-y-4">
      {listing.isOwner && (
        <div className="space-y-2 rounded-card bg-accent-100 p-4 text-accent-700">
          <p className="font-medium">{t(`listing.owner_${listing.status}`)}</p>
          {listing.moderationNote && (
            <p className="text-sm">
              {t('listing.moderationNote', { note: listing.moderationNote })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {['draft', 'active', 'paused', 'rejected', 'pending_review'].includes(
              listing.status,
            ) && (
              <Link href={`/listings/${listing.id}/edit`} className={buttonClasses('secondary')}>
                {t('listing.edit')}
              </Link>
            )}
            <Link href="/my/listings" className={buttonClasses('secondary')}>
              {t('listing.manage')}
            </Link>
          </div>
        </div>
      )}

      {total > 0 ? (
        <ul className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4">
          {listing.photos.map((photo, i) => (
            <li key={photo.id} className="w-[88%] shrink-0 snap-center sm:w-[70%]">
              {/* eslint-disable-next-line @next/next/no-img-element -- already-sized WebP from our API */}
              <img
                src={photoUrl(photo.id, 800)}
                srcSet={photoSrcSet(photo.id)}
                sizes="(max-width: 640px) 88vw, 560px"
                alt={t('listing.photoAlt', { n: i + 1, total })}
                width={800}
                height={800}
                loading={i === 0 ? 'eager' : 'lazy'}
                decoding="async"
                className="aspect-square w-full rounded-card bg-canvas object-cover"
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-card bg-canvas text-ink-muted">
          {t('listing.noPhoto')}
        </div>
      )}

      <header className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold leading-snug">{listing.title}</h1>
          {!listing.isOwner && (
            <FavouriteButton listingId={listing.id} initial={listing.isFavourite} />
          )}
        </div>
        <p className="text-2xl font-bold text-brand-700">
          {formatPrice(listing.priceMinor, locale)}
          {listing.negotiable && (
            <span className="ms-2 rounded-full bg-brand-50 px-2 py-0.5 align-middle text-sm font-medium">
              {t('listing.negotiable')}
            </span>
          )}
        </p>
        {(listing.status === 'sold' || listing.status === 'reserved') && (
          <p className="inline-block rounded-full bg-ink px-3 py-0.5 text-sm text-white">
            {t(`status.${listing.status}`)}
          </p>
        )}
        {listing.publishedAt && (
          <p className="text-sm text-ink-muted">
            {t('listing.posted', {
              time: format.relativeTime(new Date(listing.publishedAt), new Date()),
            })}
          </p>
        )}
      </header>

      <Card>
        <h2 className="mb-2 font-semibold">{t('listing.details')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink-muted">{t('listing.conditionLabel')}</dt>
          <dd>{t(`condition.${listing.condition}`)}</dd>
          <dt className="text-ink-muted">{t('listing.categoryLabel')}</dt>
          <dd>
            {listing.category.parent && `${localName(listing.category.parent, locale)} › `}
            {localName(listing.category, locale)}
          </dd>
          <dt className="text-ink-muted">{t('listing.locationLabel')}</dt>
          <dd className="flex items-center gap-1">
            <PinIcon width={16} height={16} />
            {localName(listing.city, locale)}
            {listing.neighbourhood &&
              `${locale === 'ar' ? '، ' : ', '}${localName(listing.neighbourhood, locale)}`}
          </dd>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{t('listing.description')}</h2>
        <p className="whitespace-pre-line break-words">{listing.description}</p>
      </Card>

      <Card className="flex items-center gap-3">
        {listing.seller.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- tiny WebP from our API
          <img
            src={listing.seller.avatarUrl}
            alt=""
            width={48}
            height={48}
            className="size-12 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-12 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700"
          >
            {listing.seller.displayName[0]}
          </span>
        )}
        <div>
          <p className="text-sm text-ink-muted">{t('listing.seller')}</p>
          <p className="font-semibold">{listing.seller.displayName}</p>
          <p className="text-xs text-ink-muted">
            {t('listing.memberSince', {
              date: format.dateTime(new Date(listing.seller.memberSince), {
                month: 'long',
                year: 'numeric',
              }),
            })}
          </p>
        </div>
      </Card>

      {!listing.isOwner && listing.status === 'active' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled className={buttonClasses('secondary')}>
              {t('listing.chatSeller')}
            </button>
            <button type="button" disabled className={buttonClasses('primary')}>
              {t('listing.buy')}
            </button>
          </div>
          <p className="text-center text-sm text-ink-muted">{t('listing.comingSoon')}</p>
        </div>
      )}

      <section className="rounded-card border border-brand-200 bg-brand-50 p-4 text-sm">
        <h2 className="mb-2 flex items-center gap-2 font-semibold text-brand-800">
          <ShieldIcon width={20} height={20} />
          {t('listing.safetyTitle')}
        </h2>
        <ul className="list-disc space-y-1 ps-5">
          <li>{t('listing.safety1')}</li>
          <li>{t('listing.safety2')}</li>
          <li>{t('listing.safety3')}</li>
        </ul>
      </section>

      {!listing.isOwner && <ReportForm listingId={listing.id} />}
    </article>
  );
}
