import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { LanguageSwitch } from './language-switch';

export function SiteHeader() {
  const t = useTranslations();
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
      <nav
        aria-label={t('nav.main')}
        className="mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-3 px-4"
      >
        <Link href="/" className="text-xl font-bold text-brand-700">
          {t('common.appName')}
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSwitch />
          <Link
            href="/account"
            className="inline-flex min-h-11 items-center rounded-control px-3 font-medium text-brand-700 hover:bg-brand-50"
          >
            {t('nav.account')}
          </Link>
        </div>
      </nav>
    </header>
  );
}
