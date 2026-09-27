import { PHOTO_WIDTHS, type PhotoWidth } from '@souqna/contracts/constants';

/**
 * Formats a price given in minor units (as the API's decimal string).
 * Display only: prices are capped far below 2^53 minor units, so converting to a number here
 * is exact. Money is never calculated in floating point.
 */
export function formatPrice(minor: string, locale: string): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SD' : 'en-SD', {
    style: 'currency',
    currency: 'SDG',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(minor) / 100);
}

/** Minor units → the plain number a seller typed ("150000", "99.5"), for edit forms. */
export function minorToInput(minor: string): string {
  const value = BigInt(minor);
  const major = value / 100n;
  const cents = value % 100n;
  return cents === 0n ? major.toString() : `${major}.${cents.toString().padStart(2, '0')}`;
}

export const photoUrl = (id: string, width: PhotoWidth = 800) => `/api/media/${id}?w=${width}`;

export const photoSrcSet = (id: string) =>
  PHOTO_WIDTHS.map((w) => `${photoUrl(id, w)} ${w}w`).join(', ');

export const localName = (item: { nameAr: string; nameEn: string }, locale: string) =>
  locale === 'ar' ? item.nameAr : item.nameEn;
