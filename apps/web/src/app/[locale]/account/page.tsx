'use client';

import type { MeResponse } from '@souqna/contracts';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { BalanceCard } from '@/components/balance-card';
import { DeviceList } from '@/components/device-list';
import { ProfileForm } from '@/components/profile-form';
import { Alert, Button, buttonClasses, Card } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { closeRealtime } from '@/lib/realtime';
import { compressImage } from '@/lib/compress-image';
import { useErrorMessage } from '@/lib/use-error-message';
import { useMe } from '@/lib/use-me';

export default function AccountPage() {
  const t = useTranslations();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const { me, setMe, error } = useMe();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  async function onAvatarChosen(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setAvatarError(null);
    try {
      const body = new FormData();
      body.append('file', await compressImage(file), 'avatar');
      setMe(await api<MeResponse>('/me/avatar', { body }));
    } catch (err) {
      setAvatarError(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    closeRealtime();
    router.replace('/');
  }

  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!me) return <p className="text-ink-muted">{t('common.loading')}</p>;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t('account.title')}</h1>

      <Card className="space-y-4">
        <div className="flex items-center gap-4">
          {me.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tiny, already-optimised WebP from our API
            <img
              src={me.avatarUrl}
              alt={t('account.avatarAlt')}
              width={72}
              height={72}
              className="size-18 rounded-full border border-line object-cover"
            />
          ) : (
            <div
              aria-hidden
              className="flex size-18 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-700"
            >
              {me.displayName?.[0]}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{me.displayName}</p>
            <p className="text-sm text-ink-muted">
              {t('account.phoneLabel')}: <bdi dir="ltr">{me.phone}</bdi>
            </p>
            <p className="text-sm text-ink-muted">{t('account.phonePrivate')}</p>
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          id="avatar"
          onChange={(e) => void onAvatarChosen(e.target.files?.[0])}
        />
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? t('account.avatarUploading') : t('account.changeAvatar')}
        </Button>
        {avatarError && <Alert tone="error">{avatarError}</Alert>}
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Link href="/orders" className={buttonClasses('secondary', 'col-span-2')}>
          {t('account.ordersLink')}
        </Link>
        <Link href="/my/listings" className={buttonClasses('secondary')}>
          {t('myListings.title')}
        </Link>
        <Link href="/favourites" className={buttonClasses('secondary')}>
          {t('favourites.title')}
        </Link>
      </div>

      <BalanceCard />

      <Card>
        <h2 className="mb-4 text-lg font-semibold">{t('account.profileSection')}</h2>
        <ProfileForm me={me} submitLabel={t('common.save')} onSaved={setMe} />
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">{t('account.devicesSection')}</h2>
        <DeviceList />
      </Card>

      <Button type="button" variant="danger" className="w-full" onClick={() => void logout()}>
        {t('account.logout')}
      </Button>
    </div>
  );
}
