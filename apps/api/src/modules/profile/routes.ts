import { randomUUID } from 'node:crypto';
import { updateProfileBody, type MeResponse } from '@souqna/contracts';
import { cities, media, neighbourhoods, users } from '@souqna/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import { sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../auth/session';
import { AVATAR_MAX_BYTES, processAvatar } from './avatar';

export function mediaUrl(id: string): string {
  return `/api/media/${id}`;
}

export async function loadMe(ctx: AppContext, userId: string): Promise<MeResponse> {
  const [row] = await ctx.db
    .select({
      id: users.id,
      phoneEnc: users.phoneEnc,
      displayName: users.displayName,
      avatarMediaId: users.avatarMediaId,
      trustLevel: users.trustLevel,
      cityId: cities.id,
      cityAr: cities.nameAr,
      cityEn: cities.nameEn,
      nId: neighbourhoods.id,
      nAr: neighbourhoods.nameAr,
      nEn: neighbourhoods.nameEn,
    })
    .from(users)
    .leftJoin(cities, eq(cities.id, users.cityId))
    .leftJoin(neighbourhoods, eq(neighbourhoods.id, users.neighbourhoodId))
    .where(eq(users.id, userId));
  if (!row) throw new AppError('not_found');

  return {
    id: row.id,
    phone: ctx.cipher.decrypt(row.phoneEnc),
    displayName: row.displayName,
    city: row.cityId ? { id: row.cityId, nameAr: row.cityAr!, nameEn: row.cityEn! } : null,
    neighbourhood: row.nId ? { id: row.nId, nameAr: row.nAr!, nameEn: row.nEn! } : null,
    avatarUrl: row.avatarMediaId ? mediaUrl(row.avatarMediaId) : null,
    trustLevel: row.trustLevel,
    profileComplete: Boolean(row.displayName && row.cityId),
  };
}

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;

  app.get('/me', async (request) => loadMe(ctx, requireAuth(request).userId));

  app.patch('/me', async (request) => {
    const auth = requireAuth(request);
    const body = updateProfileBody.parse(request.body);

    const [current] = await ctx.db
      .select({ cityId: users.cityId })
      .from(users)
      .where(eq(users.id, auth.userId));
    const cityId = body.cityId ?? current?.cityId ?? null;

    if (body.cityId) {
      const [city] = await ctx.db
        .select({ id: cities.id })
        .from(cities)
        .where(and(eq(cities.id, body.cityId), eq(cities.active, true)));
      if (!city) throw new AppError('validation_failed', { fields: { cityId: 'not_found' } });
    }

    let neighbourhoodId = body.neighbourhoodId;
    if (neighbourhoodId) {
      const [n] = await ctx.db
        .select({ id: neighbourhoods.id })
        .from(neighbourhoods)
        .where(
          and(
            eq(neighbourhoods.id, neighbourhoodId),
            eq(neighbourhoods.active, true),
            cityId ? eq(neighbourhoods.cityId, cityId) : undefined,
          ),
        );
      if (!n || !cityId) {
        throw new AppError('validation_failed', { fields: { neighbourhoodId: 'not_found' } });
      }
    } else if (body.cityId && body.cityId !== current?.cityId && neighbourhoodId === undefined) {
      // Changing city clears a neighbourhood that belonged to the old city.
      neighbourhoodId = null;
    }

    await ctx.db
      .update(users)
      .set({
        displayName: body.displayName,
        cityId: body.cityId,
        neighbourhoodId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, auth.userId));
    return loadMe(ctx, auth.userId);
  });

  app.post('/me/avatar', async (request) => {
    const auth = requireAuth(request);
    const file = await request.file({
      limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 0 },
    });
    if (!file) throw new AppError('upload_invalid');

    const input = await file.toBuffer();
    const image = await processAvatar(input);

    const mediaId = randomUUID();
    const storageKey = `avatars/${auth.userId}/${mediaId}.webp`;
    await ctx.storage.put(storageKey, image.data, 'image/webp');

    const previous = await ctx.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ avatarMediaId: users.avatarMediaId })
        .from(users)
        .where(eq(users.id, auth.userId))
        .for('update');
      await tx.insert(media).values({
        id: mediaId,
        ownerId: auth.userId,
        kind: 'avatar',
        storageKey,
        mime: 'image/webp',
        bytes: image.data.length,
        width: image.width,
        height: image.height,
        sha256: sha256(image.data),
      });
      await tx
        .update(users)
        .set({ avatarMediaId: mediaId, updatedAt: new Date() })
        .where(eq(users.id, auth.userId));
      if (!user?.avatarMediaId) return null;
      const [old] = await tx
        .update(media)
        .set({ status: 'deleted' })
        .where(eq(media.id, user.avatarMediaId))
        .returning({ storageKey: media.storageKey });
      return old ?? null;
    });

    if (previous) {
      await ctx.storage.delete(previous.storageKey).catch((err: unknown) => {
        request.log.warn({ err }, 'failed to delete old avatar object');
      });
    }
    return loadMe(ctx, auth.userId);
  });
}
