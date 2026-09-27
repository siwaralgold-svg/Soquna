import { randomInt } from 'node:crypto';
import type { Locale } from '@souqna/contracts';
import { otpChallenges, users } from '@souqna/db';
import { formatServerMessage } from '@souqna/i18n';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { hmac, safeEqual } from '../../lib/crypto';
import { AppError } from '../../lib/errors';

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export const OTP_LIMITS = {
  perPhone: [
    { name: 'otp:phone:10m', max: 3, windowSeconds: 10 * 60 },
    { name: 'otp:phone:1d', max: 10, windowSeconds: 24 * 60 * 60 },
  ],
  perIp: [{ name: 'otp:ip:1h', max: 20, windowSeconds: 60 * 60 }],
  verifyPerIp: [{ name: 'otp-verify:ip:10m', max: 30, windowSeconds: 10 * 60 }],
} as const;

const codeHash = (ctx: AppContext, challengeId: string, code: string) =>
  hmac(ctx.otpKey, `${challengeId}:${code}`);

export async function requestOtp(
  ctx: AppContext,
  input: { phone: string; locale: Locale; ip: string },
): Promise<{ challengeId: string; expiresInSeconds: number; resendAfterSeconds: number }> {
  const phoneHash = ctx.hashPhone(input.phone);
  const ipHash = ctx.hashIp(input.ip);

  await ctx.limiter.consume(ipHash.toString('hex'), OTP_LIMITS.perIp);
  const wait = await ctx.limiter.cooldown(
    'otp',
    phoneHash.toString('hex'),
    OTP_RESEND_COOLDOWN_SECONDS,
  );
  if (wait > 0) throw new AppError('rate_limited', { retryAfterSeconds: wait });
  await ctx.limiter.consume(phoneHash.toString('hex'), OTP_LIMITS.perPhone);

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const challengeId = crypto.randomUUID();

  await ctx.db.transaction(async (tx) => {
    // Only the newest code for a number is valid.
    await tx
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpChallenges.phoneHash, phoneHash), isNull(otpChallenges.consumedAt)));
    await tx.insert(otpChallenges).values({
      id: challengeId,
      phoneHash,
      phoneEnc: ctx.cipher.encrypt(input.phone),
      codeHash: codeHash(ctx, challengeId, code),
      ipHash,
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    });
  });

  await ctx.sms.send({
    to: input.phone,
    text: formatServerMessage(input.locale, 'otpSms', { code }),
    otpCode: code,
  });

  return {
    challengeId,
    expiresInSeconds: OTP_TTL_SECONDS,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };
}

type VerifyOutcome =
  | { ok: true; phoneHash: Buffer; phoneEnc: Buffer }
  | { ok: false; error: 'otp_invalid' | 'otp_expired' | 'otp_too_many_attempts' };

/**
 * Checks a code. The attempt counter is committed even when the code is wrong, so the
 * check runs in its own transaction and errors are thrown only after it commits.
 */
export async function verifyOtp(
  ctx: AppContext,
  input: { challengeId: string; code: string; ip: string },
): Promise<{ phone: string; phoneHash: Buffer }> {
  await ctx.limiter.consume(ctx.hashIp(input.ip).toString('hex'), OTP_LIMITS.verifyPerIp);

  const outcome = await ctx.db.transaction(async (tx): Promise<VerifyOutcome> => {
    const [challenge] = await tx
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.id, input.challengeId))
      .for('update');

    if (!challenge) return { ok: false, error: 'otp_invalid' };
    if (challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
      return { ok: false, error: 'otp_expired' };
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS)
      return { ok: false, error: 'otp_too_many_attempts' };

    const matches = safeEqual(challenge.codeHash, codeHash(ctx, challenge.id, input.code));
    const attempts = challenge.attempts + 1;
    await tx
      .update(otpChallenges)
      .set(matches ? { attempts, consumedAt: new Date() } : { attempts })
      .where(eq(otpChallenges.id, challenge.id));

    if (matches) return { ok: true, phoneHash: challenge.phoneHash, phoneEnc: challenge.phoneEnc };
    return {
      ok: false,
      error: attempts >= OTP_MAX_ATTEMPTS ? 'otp_too_many_attempts' : 'otp_invalid',
    };
  });

  if (!outcome.ok) throw new AppError(outcome.error);
  return { phone: ctx.cipher.decrypt(outcome.phoneEnc), phoneHash: outcome.phoneHash };
}

/** Finds or creates the user for a verified phone number. */
export async function findOrCreateUser(
  ctx: AppContext,
  phone: string,
  phoneHash: Buffer,
): Promise<{ id: string; status: string; isNew: boolean }> {
  const [created] = await ctx.db
    .insert(users)
    .values({ phoneHash, phoneEnc: ctx.cipher.encrypt(phone) })
    .onConflictDoNothing({ target: users.phoneHash })
    .returning({ id: users.id, status: users.status });
  if (created) return { ...created, isNew: true };

  const [existing] = await ctx.db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.phoneHash, phoneHash));
  return { ...existing!, isNew: false };
}
