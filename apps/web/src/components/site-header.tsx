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
          <Link
            href="/prohibited"
            className="inline-flex min-h-11 items-center rounded-control px-2 text-sm text-ink-muted hover:bg-canvas"
          >
            {t('footer.prohibited')}
          </Link>
          <LanguageSwitch />
        </div>
      </nav>
    </header>
  );
}
