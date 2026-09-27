'use client';

import type { CategoryTree, CitiesResponse, ListingDetail, MeResponse } from '@souqna/contracts';
import { IDEMPOTENCY_HEADER } from '@souqna/contracts/constants';
import {
  LISTING_CONDITIONS,
  MAX_LISTING_PHOTOS,
  parsePriceInput,
  type ListingCondition,
} from '@souqna/domain';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiRequestError } from '@/lib/api';
import { compressImage } from '@/lib/compress-image';
import { deleteDraft, loadDraft, saveDraft } from '@/lib/draft-store';
import { localName, minorToInput, photoUrl } from '@/lib/format';
import { useErrorMessage, useFieldError } from '@/lib/use-error-message';
import { Alert, Button, describedBy, Field, Select, TextInput } from './ui';

const DRAFT_KEY = 'new-listing';
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 2000;

interface Fields {
  title: string;
  description: string;
  categoryId: string;
  condition: ListingCondition | '';
  price: string;
  negotiable: boolean;
  cityId: string;
  neighbourhoodId: string;
}

type PhotoState = 'uploading' | 'waiting' | 'failed' | 'ready';

interface Photo {
  localId: string;
  mediaId?: string;
  /** Kept only until the upload succeeds (so it survives in the offline draft). */
  blob?: Blob;
  preview: string;
  state: PhotoState;
}

interface StoredDraft {
  fields: Fields;
  photos: Array<{ localId: string; mediaId?: string; blob?: Blob }>;
  idempotencyKey: string;
}

const newKey = () => crypto.randomUUID().replaceAll('-', '');
const newLocalId = () => crypto.randomUUID();

function fieldsFrom(me: MeResponse, listing?: ListingDetail): Fields {
  if (listing) {
    return {
      title: listing.title,
      description: listing.description,
      categoryId: listing.category.id,
      condition: listing.condition,
      price: minorToInput(listing.priceMinor),
      negotiable: listing.negotiable,
      cityId: listing.city.id,
      neighbourhoodId: listing.neighbourhood?.id ?? '',
    };
  }
  return {
    title: '',
    description: '',
    categoryId: '',
    condition: '',
    price: '',
    negotiable: false,
    cityId: me.city?.id ?? '',
    neighbourhoodId: me.neighbourhood?.id ?? '',
  };
}

/**
 * Create or edit a listing. In create mode the whole form, including photos that couldn't
 * be uploaded yet, is kept in an offline draft on the phone and restored next time.
 */
export function ListingForm({ me, listing }: { me: MeResponse; listing?: ListingDetail }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const fieldError = useFieldError();
  const isEdit = Boolean(listing);

  const [categories, setCategories] = useState<CategoryTree>([]);
  const [cities, setCities] = useState<CitiesResponse>([]);
  const [fields, setFields] = useState<Fields>(() => fieldsFrom(me, listing));
  const [photos, setPhotos] = useState<Photo[]>(
    () =>
      listing?.photos.map((p) => ({
        localId: p.id,
        mediaId: p.id,
        preview: photoUrl(p.id, 320),
        state: 'ready' as const,
      })) ?? [],
  );
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [restored, setRestored] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(isEdit);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [prohibited, setProhibited] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<CategoryTree>('/categories').then(setCategories, () => {});
    api<CitiesResponse>('/cities').then(setCities, () => {});
  }, []);

  const upload = useCallback(async (photo: Photo) => {
    if (!photo.blob) return;
    setPhotos((ps) =>
      ps.map((p) => (p.localId === photo.localId ? { ...p, state: 'uploading' } : p)),
    );
    try {
      const body = new FormData();
      body.append('file', photo.blob, 'photo');
      const { id } = await api<{ id: string }>('/listing-photos', { body });
      setPhotos((ps) =>
        ps.map((p) =>
          p.localId === photo.localId ? { ...p, mediaId: id, blob: undefined, state: 'ready' } : p,
        ),
      );
    } catch (err) {
      const offline = err instanceof ApiRequestError && err.code === 'network';
      setPhotos((ps) =>
        ps.map((p) =>
          p.localId === photo.localId ? { ...p, state: offline ? 'waiting' : 'failed' } : p,
        ),
      );
    }
  }, []);

  // Restore the offline draft (create mode only).
  useEffect(() => {
    if (isEdit) return;
    loadDraft<StoredDraft>(DRAFT_KEY).then((draft) => {
      if (draft) {
        setFields(draft.fields);
        setIdempotencyKey(draft.idempotencyKey);
        const restoredPhotos = draft.photos.map<Photo>((p) => ({
          ...p,
          preview: p.mediaId ? photoUrl(p.mediaId, 320) : URL.createObjectURL(p.blob!),
          state: p.mediaId ? 'ready' : 'waiting',
        }));
        setPhotos(restoredPhotos);
        setRestored(true);
        restoredPhotos.filter((p) => p.blob).forEach((p) => void upload(p));
      }
      setDraftLoaded(true);
    });
  }, [isEdit, upload]);

  // Keep the draft up to date on the phone.
  useEffect(() => {
    if (isEdit || !draftLoaded) return;
    const timer = setTimeout(() => {
      void saveDraft(DRAFT_KEY, {
        fields,
        idempotencyKey,
        photos: photos.map((p) => ({ localId: p.localId, mediaId: p.mediaId, blob: p.blob })),
      } satisfies StoredDraft);
    }, 400);
    return () => clearTimeout(timer);
  }, [fields, photos, idempotencyKey, isEdit, draftLoaded]);

  // Track connectivity and retry waiting uploads when it comes back.
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (online) photos.filter((p) => p.state === 'waiting').forEach((p) => void upload(p));
    // Only react to the connection coming back, not to every photo change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const room = MAX_LISTING_PHOTOS - photos.length;
    for (const file of Array.from(files).slice(0, room)) {
      const blob = await compressImage(file, 1600, 0.8);
      const photo: Photo = {
        localId: newLocalId(),
        blob,
        preview: URL.createObjectURL(blob),
        state: navigator.onLine ? 'uploading' : 'waiting',
      };
      setPhotos((ps) => [...ps, photo]);
      if (navigator.onLine) void upload(photo);
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  async function submit(publish: boolean) {
    setFormError(null);
    setProhibited(false);
    const local: Record<string, string> = {};
    if (fields.title.trim().length < 3) local.title = 'too_short';
    if (fields.description.trim().length < 10) local.description = 'too_short';
    if (!fields.categoryId) local.categoryId = 'required';
    if (!fields.condition) local.condition = 'required';
    if (parsePriceInput(fields.price) === null) local.price = 'invalid_price';
    if (!fields.cityId) local.cityId = 'required';
    const ready = photos.filter((p) => p.state === 'ready' && p.mediaId);
    if (publish && ready.length === 0) local.photoIds = 'photo_required';
    setErrors(local);
    if (Object.keys(local).length > 0 || ready.length !== photos.length) return;

    const body = {
      title: fields.title,
      description: fields.description,
      categoryId: fields.categoryId,
      condition: fields.condition,
      price: fields.price,
      negotiable: fields.negotiable,
      cityId: fields.cityId,
      neighbourhoodId: fields.neighbourhoodId || null,
      photoIds: ready.map((p) => p.mediaId!),
      publish,
    };

    setBusy(true);
    try {
      const saved = listing
        ? await api<ListingDetail>(`/listings/${listing.id}`, {
            method: 'PUT',
            json: { ...body, version: listing.version },
          })
        : await api<ListingDetail>('/listings', {
            json: body,
            headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
          });
      if (!isEdit) await deleteDraft(DRAFT_KEY);
      router.push(`/listings/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // The key only makes *retries of the same attempt* safe (lost connection, server
        // error). Once the server has given a definite answer, the next attempt is a new one.
        if (err.status >= 400 && err.status < 500) setIdempotencyKey(newKey());
        if (err.code === 'validation_failed') setErrors(err.fields);
        if (err.code === 'listing_prohibited') setProhibited(true);
        if (err.code === 'unauthenticated') router.push('/login');
      }
      setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  // Drafts and rejected listings get "Publish" + "Save draft". Editing a live listing keeps it
  // live; editing a paused one keeps it paused.
  const isDraftLike = !listing || listing.status === 'draft' || listing.status === 'rejected';
  const primaryPublishes = !listing || listing.status !== 'paused';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(primaryPublishes);
  }

  async function startOver() {
    await deleteDraft(DRAFT_KEY);
    setFields(fieldsFrom(me));
    setPhotos([]);
    setIdempotencyKey(newKey());
    setRestored(false);
  }

  const neighbourhoods = cities.find((c) => c.id === fields.cityId)?.neighbourhoods ?? [];
  const err = (name: string) => fieldError(errors[name]);
  const pending = photos.some((p) => p.state !== 'ready');

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {restored && (
        <div className="flex items-center justify-between gap-3 rounded-control bg-brand-50 px-4 py-3 text-sm">
          <span>{t('sell.draftRestored')}</span>
          <button
            type="button"
            onClick={() => void startOver()}
            className="shrink-0 text-brand-700 underline"
          >
            {t('sell.startOver')}
          </button>
        </div>
      )}
      {!online && <Alert tone="error">{t('sell.offline')}</Alert>}

      <section className="space-y-2">
        <h2 className="font-medium">{t('sell.photos')}</h2>
        <p className="text-sm text-ink-muted">{t('sell.photosHint')}</p>
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo, i) => (
            <li
              key={photo.localId}
              className="relative aspect-square overflow-hidden rounded-control bg-canvas"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview or our WebP */}
              <img src={photo.preview} alt="" className="size-full object-cover" />
              {i === 0 && (
                <span className="absolute start-1 top-1 rounded-full bg-brand-700 px-2 text-xs text-white">
                  {t('sell.cover')}
                </span>
              )}
              {photo.state !== 'ready' && (
                <button
                  type="button"
                  onClick={() => photo.state === 'failed' && void upload(photo)}
                  className="absolute inset-x-0 bottom-0 bg-ink/75 px-1 py-1 text-center text-xs text-white"
                >
                  {t(
                    photo.state === 'uploading'
                      ? 'sell.uploading'
                      : photo.state === 'waiting'
                        ? 'sell.waitingNetwork'
                        : 'sell.retryUpload',
                  )}
                </button>
              )}
              <div className="absolute end-1 top-1 flex flex-col gap-1">
                <button
                  type="button"
                  aria-label={t('sell.removePhoto')}
                  onClick={() => setPhotos((ps) => ps.filter((p) => p.localId !== photo.localId))}
                  className="flex size-8 items-center justify-center rounded-full bg-surface/90 text-lg leading-none"
                >
                  {'×'}
                </button>
              </div>
              {i > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setPhotos((ps) => [photo, ...ps.filter((p) => p.localId !== photo.localId)])
                  }
                  className="absolute bottom-7 start-1 rounded-full bg-surface/90 px-2 text-xs"
                >
                  {t('sell.makeCover')}
                </button>
              )}
            </li>
          ))}
          {photos.length < MAX_LISTING_PHOTOS && (
            <li>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-control border-2 border-dashed border-line text-sm text-brand-700"
              >
                <span aria-hidden className="text-2xl">
                  {'+'}
                </span>
                {t('sell.addPhotos')}
              </button>
            </li>
          )}
        </ul>
        <input
          ref={fileInput}
          id="photos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={(e) => void addFiles(e.target.files)}
        />
        {errors.photoIds && <p className="text-sm text-danger-600">{err('photoIds')}</p>}
      </section>

      <Field
        id="title"
        label={t('sell.titleLabel')}
        hint={t('sell.titleHint')}
        error={err('title')}
      >
        <TextInput
          id="title"
          value={fields.title}
          maxLength={TITLE_MAX}
          onChange={(e) => set('title', e.target.value)}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={describedBy('title', err('title'), t('sell.titleHint'))}
        />
      </Field>

      <Field id="categoryId" label={t('sell.categoryLabel')} error={err('categoryId')}>
        <Select
          id="categoryId"
          value={fields.categoryId}
          onChange={(e) => set('categoryId', e.target.value)}
          aria-invalid={Boolean(errors.categoryId)}
        >
          <option value="">{t('sell.categoryPlaceholder')}</option>
          {categories.map((c) =>
            c.children.length > 0 ? (
              <optgroup key={c.id} label={localName(c, locale)}>
                {c.children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {localName(child, locale)}
                  </option>
                ))}
              </optgroup>
            ) : (
              <option key={c.id} value={c.id}>
                {localName(c, locale)}
              </option>
            ),
          )}
        </Select>
      </Field>

      <fieldset className="space-y-1.5">
        <legend className="font-medium">{t('sell.conditionLabel')}</legend>
        <div className="flex flex-wrap gap-2">
          {LISTING_CONDITIONS.map((c) => (
            <label
              key={c}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 has-checked:border-brand-600 has-checked:bg-brand-50"
            >
              <input
                type="radio"
                name="condition"
                value={c}
                checked={fields.condition === c}
                onChange={() => set('condition', c)}
                className="accent-brand-600"
              />
              {t(`condition.${c}`)}
            </label>
          ))}
        </div>
        {errors.condition && <p className="text-sm text-danger-600">{err('condition')}</p>}
      </fieldset>

      <Field
        id="price"
        label={t('sell.priceLabel')}
        hint={t('sell.priceHint')}
        error={err('price')}
      >
        <div className="flex items-center gap-2">
          <TextInput
            id="price"
            inputMode="decimal"
            dir="ltr"
            className="text-start"
            value={fields.price}
            onChange={(e) => set('price', e.target.value)}
            aria-invalid={Boolean(errors.price)}
            aria-describedby={describedBy('price', err('price'), t('sell.priceHint'))}
          />
          <span className="shrink-0 text-ink-muted">{t('sell.currency')}</span>
        </div>
      </Field>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={fields.negotiable}
          onChange={(e) => set('negotiable', e.target.checked)}
          className="size-5 accent-brand-600"
        />
        {t('sell.negotiable')}
      </label>

      <Field
        id="description"
        label={t('sell.descriptionLabel')}
        hint={t('sell.descriptionHint')}
        error={err('description')}
      >
        <textarea
          id="description"
          rows={6}
          maxLength={DESCRIPTION_MAX}
          value={fields.description}
          onChange={(e) => set('description', e.target.value)}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={describedBy(
            'description',
            err('description'),
            t('sell.descriptionHint'),
          )}
          className="block w-full rounded-control border border-line bg-surface p-4 text-base aria-invalid:border-danger-600"
        />
        <p className="text-end text-xs text-ink-muted">
          {t('sell.charsLeft', { count: DESCRIPTION_MAX - fields.description.length })}
        </p>
      </Field>

      <Field id="cityId" label={t('onboarding.cityLabel')} error={err('cityId')}>
        <Select
          id="cityId"
          value={fields.cityId}
          onChange={(e) =>
            setFields((f) => ({ ...f, cityId: e.target.value, neighbourhoodId: '' }))
          }
        >
          <option value="">{t('onboarding.cityPlaceholder')}</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {localName(c, locale)}
            </option>
          ))}
        </Select>
      </Field>
      {neighbourhoods.length > 0 && (
        <Field id="neighbourhoodId" label={t('onboarding.neighbourhoodLabel')}>
          <Select
            id="neighbourhoodId"
            value={fields.neighbourhoodId}
            onChange={(e) => set('neighbourhoodId', e.target.value)}
          >
            <option value="">{t('onboarding.neighbourhoodPlaceholder')}</option>
            {neighbourhoods.map((n) => (
              <option key={n.id} value={n.id}>
                {localName(n, locale)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <p className="rounded-control bg-canvas px-4 py-3 text-sm text-ink-muted">
        {t('sell.policy')}{' '}
        <Link href="/prohibited" className="text-brand-700 underline">
          {t('sell.policyLink')}
        </Link>
      </p>

      {formError && <Alert tone="error">{formError}</Alert>}
      {prohibited && (
        <Link href="/prohibited" className="block text-sm text-brand-700 underline">
          {t('sell.policyLink')}
        </Link>
      )}

      <div className="space-y-2">
        <Button type="submit" className="w-full" disabled={busy || pending || !online}>
          {busy ? t('sell.sending') : isDraftLike ? t('sell.publish') : t('sell.saveChanges')}
        </Button>
        {isDraftLike && (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy || pending || !online}
            onClick={() => void submit(false)}
          >
            {t('sell.saveDraft')}
          </Button>
        )}
      </div>
    </form>
  );
}
