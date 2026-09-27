import {
  cleanDisplayName,
  normalizeSudanPhone,
  toAsciiDigits,
  validateDisplayName,
} from '@souqna/domain';
import { z } from 'zod';
import { LOCALES } from './constants';

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
