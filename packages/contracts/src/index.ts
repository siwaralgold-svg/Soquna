import {
  cleanDisplayName,
  containsContactInfo,
  LISTING_CONDITIONS,
  LISTING_STATUSES,
  MAX_LISTING_PHOTOS,
  normalizeSudanPhone,
  parsePriceInput,
  toAsciiDigits,
  validateDisplayName,
} from '@souqna/domain';
import { z } from 'zod';
import { LISTING_SORTS, LOCALES, REPORT_REASONS } from './constants';

export * from './constants';

export const phoneSchema = z.string().transform((value, ctx) => {
  const normalised = normalizeSudanPhone(value);
  if (!normalised) {
    ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
    return z.NEVER;
  }
  return normalised;
});

export const otpRequestBody = z.object({
  phone: phoneSchema,
  locale: z.enum(LOCALES).default('ar'),
});
export type OtpRequestBody = z.input<typeof otpRequestBody>;

export const otpRequestResponse = z.object({
  challengeId: z.uuid(),
  expiresInSeconds: z.number().int(),
  resendAfterSeconds: z.number().int(),
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponse>;

export const otpVerifyBody = z.object({
  challengeId: z.uuid(),
  code: z
    .string()
    .transform((v) => toAsciiDigits(v).trim())
    .pipe(z.string().regex(/^\d{6}$/, 'invalid_code')),
});
export type OtpVerifyBody = z.input<typeof otpVerifyBody>;

export const displayNameSchema = z.string().transform((value, ctx) => {
  const error = validateDisplayName(value);
  if (error) {
    ctx.addIssue({ code: 'custom', message: `display_name_${error}` });
    return z.NEVER;
  }
  return cleanDisplayName(value);
});

export const updateProfileBody = z
  .object({
    displayName: displayNameSchema.optional(),
    cityId: z.uuid().optional(),
    neighbourhoodId: z.uuid().nullable().optional(),
  })
  .strict();
export type UpdateProfileBody = z.input<typeof updateProfileBody>;

export const citySummary = z.object({
  id: z.uuid(),
  nameAr: z.string(),
  nameEn: z.string(),
});

export const meResponse = z.object({
  id: z.uuid(),
  phone: z.string(),
  displayName: z.string().nullable(),
  city: citySummary.nullable(),
  neighbourhood: citySummary.nullable(),
  avatarUrl: z.string().nullable(),
  trustLevel: z.enum(['phone_verified', 'id_verified', 'trusted']),
  profileComplete: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponse>;

export const sessionSummary = z.object({
  id: z.uuid(),
  deviceLabel: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummary>;

export const citiesResponse = z.array(
  citySummary.extend({
    neighbourhoods: z.array(citySummary),
  }),
);
export type CitiesResponse = z.infer<typeof citiesResponse>;

// ---------------------------------------------------------------------------
// Listings

/** Free text shown publicly: trimmed, and no phone numbers or links (anti-fraud). */
const publicText = (min: number, max: number) =>
  z
    .string()
    .transform((v) => v.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim())
    .pipe(
      z
        .string()
        .min(min, 'too_short')
        .max(max, 'too_long')
        .refine((v) => !containsContactInfo(v), 'contains_contact'),
    );

export const LISTING_TITLE_MAX = 80;
export const LISTING_DESCRIPTION_MAX = 2000;

/** Prices travel as decimal strings ("15000", "99.50"); the server stores bigint minor units. */
export const priceSchema = z.string().transform((value, ctx) => {
  const minor = parsePriceInput(value);
  if (minor === null) {
    ctx.addIssue({ code: 'custom', message: 'invalid_price' });
    return z.NEVER;
  }
  return minor;
});

export const listingInput = z
  .object({
    title: publicText(3, LISTING_TITLE_MAX),
    description: publicText(10, LISTING_DESCRIPTION_MAX),
    categoryId: z.uuid(),
    condition: z.enum(LISTING_CONDITIONS),
    price: priceSchema,
    negotiable: z.boolean().default(false),
    cityId: z.uuid(),
    neighbourhoodId: z.uuid().nullable().default(null),
    photoIds: z.array(z.uuid()).max(MAX_LISTING_PHOTOS, 'too_many_photos').default([]),
    /** false saves a draft; true publishes (needs at least one photo). */
    publish: z.boolean(),
  })
  .strict()
  .refine((v) => !v.publish || v.photoIds.length > 0, {
    path: ['photoIds'],
    message: 'photo_required',
  })
  .refine((v) => new Set(v.photoIds).size === v.photoIds.length, {
    path: ['photoIds'],
    message: 'duplicate_photo',
  });
export type ListingInput = z.input<typeof listingInput>;

export const updateListingInput = listingInput.and(z.object({ version: z.number().int() }));
export type UpdateListingInput = z.input<typeof updateListingInput>;

export const listingActionInput = z
  .object({ action: z.enum(['publish', 'pause', 'resume', 'delete']) })
  .strict();

export const reportInput = z
  .object({
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

const optionalNumber = z.coerce.number().int().min(0).optional();

export const listingSearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.uuid().optional(),
  city: z.uuid().optional(),
  minPrice: z.string().optional(),
  maxPrice: z.string().optional(),
  condition: z
    .union([z.enum(LISTING_CONDITIONS), z.array(z.enum(LISTING_CONDITIONS))])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])),
  sort: z.enum(LISTING_SORTS).optional(),
  page: optionalNumber.pipe(z.number().max(50).optional()),
});
export type ListingSearchQuery = z.input<typeof listingSearchQuery>;

const named = z.object({ id: z.uuid(), nameAr: z.string(), nameEn: z.string() });

export const photoRef = z.object({ id: z.uuid() });

export const listingCard = z.object({
  id: z.uuid(),
  title: z.string(),
  priceMinor: z.string(),
  negotiable: z.boolean(),
  condition: z.enum(LISTING_CONDITIONS),
  status: z.enum(LISTING_STATUSES),
  city: named,
  coverPhotoId: z.uuid().nullable(),
  publishedAt: z.string().nullable(),
});
export type ListingCard = z.infer<typeof listingCard>;

export const listingPage = z.object({
  items: z.array(listingCard),
  page: z.number(),
  hasMore: z.boolean(),
});
export type ListingPage = z.infer<typeof listingPage>;

export const listingDetail = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  priceMinor: z.string(),
  negotiable: z.boolean(),
  condition: z.enum(LISTING_CONDITIONS),
  status: z.enum(LISTING_STATUSES),
  category: named.extend({ parent: named.nullable() }),
  city: named,
  neighbourhood: named.nullable(),
  photos: z.array(photoRef),
  seller: z.object({
    id: z.uuid(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    memberSince: z.string(),
  }),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  version: z.number(),
  isOwner: z.boolean(),
  isFavourite: z.boolean(),
  /** Only sent to the owner. */
  moderationNote: z.string().nullable(),
});
export type ListingDetail = z.infer<typeof listingDetail>;

export const categoryTree = z.array(named.extend({ children: z.array(named) }));
export type CategoryTree = z.infer<typeof categoryTree>;
