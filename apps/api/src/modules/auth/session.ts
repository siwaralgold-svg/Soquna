import { sessions, users } from '@souqna/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext, AuthState } from '../../context';
import { randomToken, sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';

export const SESSION_COOKIE = 'sq_sid';
export const SESSION_ABSOLUTE_DAYS = 90;
export const SESSION_IDLE_DAYS = 30;
const TOUCH_AFTER_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function requireAuth(request: FastifyRequest): AuthState {
  if (!request.auth) throw new AppError('unauthenticated');
  return request.auth;
}

export async function createSession(
  ctx: AppContext,
  reply: FastifyReply,
  input: { userId: string; deviceLabel: string; ipHash: Buffer },
): Promise<string> {
  const token = randomToken();
  const [row] = await ctx.db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: sha256(token),
      deviceLabel: input.deviceLabel,
      ipHash: input.ipHash,
      expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_DAYS * DAY_MS),
    })
    .returning({ id: sessions.id });

  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: ctx.config.SESSION_COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_ABSOLUTE_DAYS * 24 * 60 * 60,
  });
  return row!.id;
}

export function clearSessionCookie(ctx: AppContext, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: ctx.config.SESSION_COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
}

export async function revokeSession(ctx: AppContext, sessionId: string): Promise<void> {
  await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  ctx.realtime?.endSessions([sessionId]);
}

/**
 * Turns a session cookie value into the logged-in user, or null if the session is missing,
 * revoked, expired, idle too long, or the account isn't active. Used by HTTP requests and by
 * the realtime (Socket.IO) handshake.
 */
export async function resolveSession(ctx: AppContext, token: string): Promise<AuthState | null> {
  const [row] = await ctx.db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      userStatus: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);

  const now = Date.now();
  if (
    !row ||
    row.revokedAt ||
    row.expiresAt.getTime() <= now ||
    now - row.lastSeenAt.getTime() > SESSION_IDLE_DAYS * DAY_MS ||
    row.userStatus !== 'active'
  ) {
    return null;
  }

  if (now - row.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await ctx.db
      .update(sessions)
      .set({ lastSeenAt: sql`now()` })
      .where(eq(sessions.id, row.id));
  }
  return { sessionId: row.id, userId: row.userId };
}

/** Resolves the session cookie into `request.auth` (or null) on every request. */
export function registerSessionHook(app: FastifyInstance): void {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) request.auth = await resolveSession(app.ctx, token);
  });
}
