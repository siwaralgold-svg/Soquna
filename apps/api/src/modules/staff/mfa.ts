import type { StaffMe } from '@souqna/contracts';
import { sessions, staffMfa, userRoles } from '@souqna/db';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { newTotpSecret, verifyTotp } from '../../lib/totp';
import { requireAuth } from '../auth/session';

export const STAFF_ROLES = ['courier', 'moderator', 'finance', 'admin', 'verifier'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** A staff member re-enters a 2FA code after this long (a working day). */
export const MFA_VALID_HOURS = 12;
/** Wrong codes per session per 15 minutes before we stop checking. */
export const MFA_ATTEMPTS = 5;

export async function rolesOf(ctx: AppContext, userId: string): Promise<StaffRole[]> {
  const rows = await ctx.db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.role);
}

/** Creates (or replaces) a staff member's TOTP secret. Used by the `pnpm staff` CLI only. */
export async function enrolTotp(
  ctx: Pick<AppContext, 'db' | 'cipher'>,
  userId: string,
): Promise<string> {
  const secret = newTotpSecret();
  const secretEnc = ctx.cipher.encrypt(secret);
  await ctx.db
    .insert(staffMfa)
    .values({ userId, secretEnc })
    .onConflictDoUpdate({ target: staffMfa.userId, set: { secretEnc, lastUsedStep: null } });
  return secret;
}

async function mfaVerifiedAt(ctx: AppContext, sessionId: string): Promise<Date | null> {
  const [row] = await ctx.db
    .select({ at: sessions.mfaVerifiedAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return row?.at ?? null;
}

const fresh = (at: Date | null) =>
  at !== null && Date.now() - at.getTime() < MFA_VALID_HOURS * 3_600_000;

export async function staffMe(ctx: AppContext, request: FastifyRequest): Promise<StaffMe> {
  const auth = requireAuth(request);
  const roles = await rolesOf(ctx, auth.userId);
  if (roles.length === 0) throw new AppError('not_found');
  const [enrolled] = await ctx.db
    .select({ userId: staffMfa.userId })
    .from(staffMfa)
    .where(eq(staffMfa.userId, auth.userId));
  return {
    roles,
    mfaEnrolled: Boolean(enrolled),
    mfaVerified: fresh(await mfaVerifiedAt(ctx, auth.sessionId)),
  };
}

/**
 * Checks a 6-digit code and marks this session as 2FA-verified. A code works once: the
 * accepted time step is stored and the update only succeeds for a newer step.
 */
export async function verifyStaffCode(ctx: AppContext, request: FastifyRequest, code: string) {
  const auth = requireAuth(request);
  if ((await rolesOf(ctx, auth.userId)).length === 0) throw new AppError('not_found');
  await ctx.limiter.consume(auth.sessionId, [
    { name: 'mfa:session:15m', max: MFA_ATTEMPTS, windowSeconds: 15 * 60 },
  ]);

  const [row] = await ctx.db.select().from(staffMfa).where(eq(staffMfa.userId, auth.userId));
  if (!row) throw new AppError('mfa_required');
  const step = verifyTotp(ctx.cipher.decrypt(row.secretEnc), code);
  if (step === null) throw new AppError('otp_invalid');

  const used = await ctx.db
    .update(staffMfa)
    .set({ lastUsedStep: step })
    .where(
      and(
        eq(staffMfa.userId, auth.userId),
        or(isNull(staffMfa.lastUsedStep), lt(staffMfa.lastUsedStep, step)),
      ),
    )
    .returning({ userId: staffMfa.userId });
  if (used.length === 0) throw new AppError('otp_invalid'); // replayed code

  await ctx.db
    .update(sessions)
    .set({ mfaVerifiedAt: new Date() })
    .where(eq(sessions.id, auth.sessionId));
}

/**
 * Staff-only routes: the person must hold one of `roles` AND have entered a 2FA code on
 * this session recently. People without a staff role get a 404, so the routes don't
 * advertise themselves.
 */
export async function requireStaff(
  ctx: AppContext,
  request: FastifyRequest,
  roles: readonly StaffRole[],
): Promise<{ userId: string; roles: StaffRole[] }> {
  const auth = requireAuth(request);
  const held = await rolesOf(ctx, auth.userId);
  if (!held.some((r) => roles.includes(r))) throw new AppError('not_found');
  if (!fresh(await mfaVerifiedAt(ctx, auth.sessionId))) throw new AppError('mfa_required');
  return { userId: auth.userId, roles: held };
}
