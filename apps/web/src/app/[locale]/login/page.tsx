import { useTranslations } from 'next-intl';
import { LoginFlow } from './login-flow';

export default function LoginPage() {
  const t = useTranslations('login');
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-ink-muted">{t('intro')}</p>
      </div>
      <LoginFlow />
    </div>
  );
}
