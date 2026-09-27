import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui';

const ITEMS = [
  'weapons',
  'drugs',
  'medicine',
  'animals',
  'stolen',
  'counterfeit',
  'documents',
  'currency',
] as const;

export async function generateMetadata() {
  const t = await getTranslations('prohibited');
  return { title: t('title') };
}

export default async function ProhibitedPage() {
  const t = await getTranslations('prohibited');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p>{t('intro')}</p>
      <Card>
        <ul className="list-disc space-y-2 ps-5">
          {ITEMS.map((item) => (
            <li key={item}>{t(item)}</li>
          ))}
        </ul>
      </Card>
      <p className="text-sm text-ink-muted">{t('review')}</p>
    </div>
  );
}
