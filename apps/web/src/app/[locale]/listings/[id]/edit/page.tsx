'use client';

import type { ListingDetail } from '@souqna/contracts';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ListingForm } from '@/components/listing-form';
import { Alert } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';
import { useMe } from '@/lib/use-me';

export default function EditListingPage() {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const { id } = useParams<{ id: string }>();
  const { me, error: meError } = useMe();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<ListingDetail>(`/listings/${id}`).then(
      (l) => (l.isOwner ? setListing(l) : setError(new ApiRequestError('not_found', 404))),
      setError,
    );
  }, [id]);

  const failure = meError ?? error;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('sell.editTitle')}</h1>
      {failure ? <Alert tone="error">{errorMessage(failure)}</Alert> : null}
      {me && listing ? (
        <ListingForm me={me} listing={listing} />
      ) : (
        !failure && <p className="text-ink-muted">{t('common.loading')}</p>
      )}
    </div>
  );
}
