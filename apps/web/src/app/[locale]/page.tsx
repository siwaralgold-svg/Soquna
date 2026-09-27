import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui';

export default function HomePage() {
  const t = useTranslations('home');
  const format = useFormatter();
  const steps = [t('step1'), t('step2'), t('step3')];

  return (
    <div className="space-y-6">
      <section className="rounded-card bg-brand-700 p-6 text-white">
        <h1 className="text-2xl font-bold leading-snug">{t('promiseTitle')}</h1>
        <p className="mt-3 text-brand-100">{t('promiseBody')}</p>
        <Link href="/login" className={buttonClasses('light', 'mt-5 w-full')}>
          {t('getStarted')}
        </Link>
      </section>

      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold">{t('stepsTitle')}</h2>
        <ol className="mt-4 space-y-4">
          {steps.map((step, i) => (
            <li key={step} className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700"
              >
                {format.number(i + 1)}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="rounded-card border border-dashed border-line p-5 text-center text-ink-muted">
        {t('comingSoon')}
      </p>
    </div>
  );
}
