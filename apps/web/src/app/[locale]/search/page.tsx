import type { CategoryTree, CitiesResponse, ListingPage } from '@souqna/contracts';
import { LISTING_SORTS } from '@souqna/contracts/constants';
import { LISTING_CONDITIONS } from '@souqna/domain';
import { getLocale, getTranslations } from 'next-intl/server';
import { ListingGrid } from '@/components/listing-card';
import { SearchBox } from '@/components/search-box';
import { buttonClasses } from '@/components/ui';
import { getPathname, Link } from '@/i18n/navigation';
import { localName } from '@/lib/format';
import { serverGet } from '@/lib/server-api';

type Params = Record<string, string | string[] | undefined>;

const FILTER_KEYS = ['q', 'category', 'city', 'minPrice', 'maxPrice', 'condition', 'sort'] as const;

function toQuery(params: Params, overrides: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = params[key];
    for (const v of Array.isArray(value) ? value : value ? [value] : []) {
      if (v) query.append(key, v);
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    query.delete(k);
    if (v) query.set(k, v);
  }
  return query;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const t = await getTranslations();
  const locale = await getLocale();
  const page = Math.min(Math.max(Number(one(params.page)) || 0, 0), 50);
  const query = toQuery(params, { page: page > 0 ? String(page) : undefined });

  const [results, categories, cities] = await Promise.all([
    serverGet<ListingPage>(`/listings?${query}`).catch(() => null),
    serverGet<CategoryTree>('/categories'),
    serverGet<CitiesResponse>('/cities'),
  ]);

  const selectedConditions = new Set(
    Array.isArray(params.condition) ? params.condition : params.condition ? [params.condition] : [],
  );
  const q = one(params.q);
  const pageHref = (p: number) =>
    `${getPathname({ href: '/search', locale })}?${toQuery(params, { page: p > 0 ? String(p) : undefined })}`;
  const fieldClass = 'min-h-11 w-full rounded-control border border-line bg-surface px-3 text-base';

  return (
    <div className="space-y-4">
      <h1 className="sr-only">{t('search.title')}</h1>
      <SearchBox action={getPathname({ href: '/search', locale })} defaultValue={q} />

      <details className="rounded-card border border-line bg-surface">
        <summary className="flex min-h-12 cursor-pointer items-center px-4 font-medium">
          {t('search.filters')}
        </summary>
        <form method="get" className="grid grid-cols-2 gap-3 px-4 pb-4">
          {q && <input type="hidden" name="q" value={q} />}
          <label className="col-span-2 space-y-1">
            <span className="text-sm">{t('search.category')}</span>
            <select
              name="category"
              defaultValue={one(params.category) ?? ''}
              className={fieldClass}
            >
              <option value="">{t('search.allCategories')}</option>
              {categories?.map((c) => (
                <optgroup key={c.id} label={localName(c, locale)}>
                  <option value={c.id}>{localName(c, locale)}</option>
                  {c.children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {localName(child, locale)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-sm">{t('search.city')}</span>
            <select name="city" defaultValue={one(params.city) ?? ''} className={fieldClass}>
              <option value="">{t('search.allCities')}</option>
              {cities?.map((c) => (
                <option key={c.id} value={c.id}>
                  {localName(c, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm">{t('search.minPrice')}</span>
            <input
              name="minPrice"
              inputMode="decimal"
              dir="ltr"
              defaultValue={one(params.minPrice)}
              className={fieldClass}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm">{t('search.maxPrice')}</span>
            <input
              name="maxPrice"
              inputMode="decimal"
              dir="ltr"
              defaultValue={one(params.maxPrice)}
              className={fieldClass}
            />
          </label>
          <fieldset className="col-span-2">
            <legend className="mb-1 text-sm">{t('search.condition')}</legend>
            <div className="flex flex-wrap gap-2">
              {LISTING_CONDITIONS.map((c) => (
                <label
                  key={c}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line px-3 text-sm has-checked:border-brand-600 has-checked:bg-brand-50"
                >
                  <input
                    type="checkbox"
                    name="condition"
                    value={c}
                    defaultChecked={selectedConditions.has(c)}
                    className="accent-brand-600"
                  />
                  {t(`condition.${c}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="col-span-2 space-y-1">
            <span className="text-sm">{t('search.sort')}</span>
            <select name="sort" defaultValue={one(params.sort) ?? ''} className={fieldClass}>
              <option value="">{t(q ? 'search.sort_relevance' : 'search.sort_newest')}</option>
              {LISTING_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`search.sort_${s}`)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClasses('primary', 'col-span-1')}>
            {t('search.apply')}
          </button>
          <Link href="/search" className={buttonClasses('secondary', 'col-span-1')}>
            {t('search.clear')}
          </Link>
        </form>
      </details>

      {q && <p className="font-semibold">{t('search.resultsFor', { q })}</p>}

      {results && results.items.length > 0 ? (
        <ListingGrid items={results.items} />
      ) : (
        <p className="rounded-card border border-dashed border-line p-6 text-center text-ink-muted">
          {t('search.noResults')}
        </p>
      )}

      {results && (page > 0 || results.hasMore) && (
        <nav className="flex justify-between gap-3">
          {page > 0 ? (
            <a href={pageHref(page - 1)} className={buttonClasses('secondary')}>
              {t('search.previous')}
            </a>
          ) : (
            <span />
          )}
          {results.hasMore && (
            <a href={pageHref(page + 1)} className={buttonClasses('secondary')}>
              {t('search.next')}
            </a>
          )}
        </nav>
      )}
    </div>
  );
}
