import { useTranslations } from 'next-intl';
import { SearchIcon } from './icons';

/** A plain GET form: works without JavaScript and on the slowest phones. */
export function SearchBox({ action, defaultValue }: { action: string; defaultValue?: string }) {
  const t = useTranslations();
  return (
    <form action={action} method="get" role="search" className="flex gap-2">
      <label htmlFor="q" className="sr-only">
        {t('search.title')}
      </label>
      <input
        id="q"
        name="q"
        type="search"
        enterKeyHint="search"
        defaultValue={defaultValue}
        placeholder={t('home.searchPlaceholder')}
        className="min-h-12 w-full rounded-control border border-line bg-surface px-4 text-base placeholder:text-ink-muted"
      />
      <button
        type="submit"
        aria-label={t('search.submit')}
        className="flex min-h-12 min-w-12 items-center justify-center rounded-control bg-brand-600 text-white"
      >
        <SearchIcon />
      </button>
    </form>
  );
}
