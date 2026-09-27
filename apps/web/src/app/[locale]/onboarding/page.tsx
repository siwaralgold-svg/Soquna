'use client';

import { useTranslations } from 'next-intl';
import { ProfileForm } from '@/components/profile-form';
import { Alert, Card } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { useErrorMessage } from '@/lib/use-error-message';
import { useMe } from '@/lib/use-me';

export default function OnboardingPage() {
  const t = useTranslations();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const { me, error } = useMe({ allowIncomplete: true });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t('onboarding.title')}</h1>
        <p className="mt-1 text-ink-muted">{t('onboarding.intro')}</p>
      </div>
      {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
      {me ? (
        <Card>
          <ProfileForm
            me={me}
            submitLabel={t('onboarding.submit')}
            onSaved={() => router.replace('/account')}
          />
        </Card>
      ) : (
        !error && <p className="text-ink-muted">{t('common.loading')}</p>
      )}
    </div>
  );
}
