import type { CategoryTree, ListingPage } from '@souqna/contracts';
import { getLocale, getTranslations } from 'next-intl/server';
import { ShieldIcon } from '@/components/icons';
import { ListingGrid } from '@/components/listing-card';
import { SearchBox } from '@/components/search-box';
import { buttonClasses } from '@/components/ui';
import { getPathname, Link } from '@/i18n/navigation';
import { localName } from '@/lib/format';
import { serverGet } from '@/lib/server-api';

export default async function HomePage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const [latest, categories] = await Promise.all([
    serverGet<ListingPage>('/listings?sort=newest'),
    serverGet<CategoryTree>('/categories'),
  ]);

  return (
    <div className="space-y-6">
      <SearchBox action={getPathname({ href: '/search', locale })} />

      <section className="flex gap-3 rounded-card bg-brand-700 p-4 text-white">
        <ShieldIcon className="mt-0.5 shrink-0" />
        <div>
          <h1 className="font-bold leading-snug">{t('home.promiseTitle')}</h1>
          <p className="mt-1 text-sm text-brand-100">{t('home.promiseBody')}</p>
        </div>
      </section>

      {categories && categories.length > 0 && (
        <section aria-labelledby="categories-title">
          <h2 id="categories-title" className="mb-2 font-semibold">
            {t('home.categoriesTitle')}
          </h2>
          <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {categories.map((c) => (
              <li key={c.id} className="shrink-0">
                <Link
                  href={{ pathname: '/search', query: { category: c.id } }}
                  className="inline-flex min-h-10 items-center rounded-full border border-line bg-surface px-4 text-sm"
                >
                  {localName(c, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="latest-title" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="latest-title" className="font-semibold">
            {t('home.latestTitle')}
          </h2>
          {latest?.hasMore && (
            <Link href="/search" className="text-sm text-brand-700">
              {t('home.seeAll')}
            </Link>
          )}
        </div>
        {latest && latest.items.length > 0 ? (
          <ListingGrid items={latest.items} />
        ) : (
          <div className="rounded-card border border-dashed border-line p-6 text-center">
            <p className="text-ink-muted">{t('home.emptyFeed')}</p>
            <Link href="/sell" className={buttonClasses('primary', 'mt-4')}>
              {t('nav.sell')}
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
