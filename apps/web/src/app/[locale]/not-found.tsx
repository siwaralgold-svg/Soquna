import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <div className="py-12 text-center">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <Link href="/" className={buttonClasses('primary', 'mt-6')}>
        {t('backHome')}
      </Link>
    </div>
  );
}
