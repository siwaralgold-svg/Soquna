import { IDEMPOTENCY_HEADER } from '@souqna/contracts';
import { idempotencyKeys } from '@souqna/db';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sha256 } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { requireAuth } from '../modules/auth/session';

declare module 'fastify' {
  interface FastifyRequest {
    idempotency?: { userId: string; key: string };
  }
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
/** A request still "in progress" after this long is assumed to have crashed and may be retried. */
const STALE_AFTER_SECONDS = 60;

/**
 * Route hooks that make a write safe to retry. The client sends `Idempotency-Key` (a random
 * id per user action). The first request runs normally and its response is stored; a retry
 * with the same key gets the stored response back instead of running the action twice.
 * The same key with a different body, or while the first request is still running, is a 409.
 */
export function idempotency(app: FastifyInstance) {
  const { db } = app.ctx;

  async function preHandler(request: FastifyRequest, reply: FastifyReply) {
    const { userId } = requireAuth(request);
    const key = request.headers[IDEMPOTENCY_HEADER];
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      throw new AppError('validation_failed', { fields: { [IDEMPOTENCY_HEADER]: 'required' } });
    }

    const requestHash = sha256(
      JSON.stringify([request.method, request.routeOptions.url, request.params, request.body]),
    );
    const [claimed] = await db
      .insert(idempotencyKeys)
      .values({ userId, key, route: request.routeOptions.url ?? '', requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (claimed) {
      request.idempotency = { userId, key };
      return;
    }

    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    if (!existing || !existing.requestHash.equals(requestHash)) {
      throw new AppError('idempotency_conflict');
    }

    if (existing.completedAt) {
      return reply
        .header('idempotent-replayed', 'true')
        .status(existing.statusCode ?? 200)
        .send(existing.response);
    }

    // Still running, unless the earlier attempt died: then take it over.
    const [takenOver] = await db
      .update(idempotencyKeys)
      .set({ createdAt: sql`now()` })
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.key, key),
          lt(idempotencyKeys.createdAt, sql`now() - make_interval(secs => ${STALE_AFTER_SECONDS})`),
        ),
      )
      .returning({ key: idempotencyKeys.key });
    if (!takenOver) throw new AppError('idempotency_conflict');
    request.idempotency = { userId, key };
  }

  async function onSend(request: FastifyRequest, reply: FastifyReply, payload: unknown) {
    const record = request.idempotency;
    if (!record) return payload;
    const where = and(
      eq(idempotencyKeys.userId, record.userId),
      eq(idempotencyKeys.key, record.key),
    );

    if (reply.statusCode >= 500) {
      // Let the client retry after a server failure.
      await db.delete(idempotencyKeys).where(where);
      return payload;
    }

    let response: unknown = null;
    if (typeof payload === 'string' && payload.length > 0) {
      try {
        response = JSON.parse(payload);
      } catch {
        response = null;
      }
    }
    await db
      .update(idempotencyKeys)
      .set({ statusCode: reply.statusCode, response, completedAt: sql`now()` })
      .where(where);
    return payload;
  }

  return { preHandler, onSend };
}
