'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

export function LanguageSwitch() {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === 'ar' ? 'en' : 'ar';

  return (
    <Link
      href={pathname}
      locale={other}
      lang={other}
      aria-label={t('switchLanguageLabel')}
      className="inline-flex min-h-11 items-center rounded-control px-3 text-ink-muted hover:bg-canvas"
    >
      {t('switchLanguage')}
    </Link>
  );
}
