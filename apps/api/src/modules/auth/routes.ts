import {
  otpRequestBody,
  otpVerifyBody,
  type OtpRequestResponse,
  type SessionSummary,
} from '@souqna/contracts';
import { sessions } from '@souqna/db';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../../audit';
import { deviceLabel } from '../../lib/device';
import { AppError } from '../../lib/errors';
import { findOrCreateUser, requestOtp, verifyOtp } from './otp';
import { clearSessionCookie, createSession, requireAuth, revokeSession } from './session';

const sessionIdParams = z.object({ id: z.uuid() });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;

  app.post('/auth/otp/request', async (request, reply) => {
    const body = otpRequestBody.parse(request.body);
    const result: OtpRequestResponse = await requestOtp(ctx, { ...body, ip: request.ip });
    return reply.status(201).send(result);
  });

  app.post('/auth/otp/verify', async (request, reply) => {
    const body = otpVerifyBody.parse(request.body);
    const { phone, phoneHash } = await verifyOtp(ctx, { ...body, ip: request.ip });

    const user = await findOrCreateUser(ctx, phone, phoneHash);
    if (user.status !== 'active') throw new AppError('account_suspended');

    // Session rotation: any session this browser already had is ended.
    if (request.auth) await revokeSession(ctx, request.auth.sessionId);

    const sessionId = await createSession(ctx, reply, {
      userId: user.id,
      deviceLabel: deviceLabel(request.headers['user-agent']),
      ipHash: ctx.hashIp(request.ip),
    });
    await writeAudit(ctx, {
      actorId: user.id,
      actorRole: 'user',
      action: user.isNew ? 'auth.signup' : 'auth.login',
      targetType: 'session',
      targetId: sessionId,
      ip: request.ip,
    });
    return { isNewUser: user.isNew };
  });

  app.post('/auth/logout', async (request, reply) => {
    if (request.auth) {
      await revokeSession(ctx, request.auth.sessionId);
      await writeAudit(ctx, {
        actorId: request.auth.userId,
        actorRole: 'user',
        action: 'auth.logout',
        targetType: 'session',
        targetId: request.auth.sessionId,
        ip: request.ip,
      });
    }
    clearSessionCookie(ctx, reply);
    return reply.status(204).send();
  });

  app.get('/auth/sessions', async (request): Promise<SessionSummary[]> => {
    const auth = requireAuth(request);
    const rows = await ctx.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, auth.userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt));
    return rows.map((s) => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.id === auth.sessionId,
    }));
  });

  app.delete('/auth/sessions/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = sessionIdParams.parse(request.params);
    // Object-level check: the WHERE clause only matches the caller's own sessions, so another
    // user's session id behaves exactly like one that doesn't exist.
    const revoked = await ctx.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, id), eq(sessions.userId, auth.userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (revoked.length === 0) throw new AppError('not_found');
    ctx.realtime?.endSessions([id]);

    await writeAudit(ctx, {
      actorId: auth.userId,
      actorRole: 'user',
      action: 'auth.sessions.revoke',
      targetType: 'session',
      targetId: id,
      ip: request.ip,
    });
    if (id === auth.sessionId) clearSessionCookie(ctx, reply);
    return reply.status(204).send();
  });

  app.post('/auth/sessions/revoke-others', async (request) => {
    const auth = requireAuth(request);
    const revoked = await ctx.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, auth.userId),
          ne(sessions.id, auth.sessionId),
          isNull(sessions.revokedAt),
        ),
      )
      .returning({ id: sessions.id });
    ctx.realtime?.endSessions(revoked.map((s) => s.id));
    await writeAudit(ctx, {
      actorId: auth.userId,
      actorRole: 'user',
      action: 'auth.sessions.revoke_others',
      metadata: { count: revoked.length },
      ip: request.ip,
    });
    return { revoked: revoked.length };
  });
}
