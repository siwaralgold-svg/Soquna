import { PHOTO_WIDTHS, type CitiesResponse, type PhotoWidth } from '@souqna/contracts';
import { cities, listingPhotos, listings, media, neighbourhoods } from '@souqna/db';
import { isPubliclyVisible } from '@souqna/domain';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { photoKey } from '../listings/photos';

const mediaParams = z.object({ id: z.uuid() });
const mediaQuery = z.object({
  w: z.coerce
    .number()
    .refine((w): w is PhotoWidth => (PHOTO_WIDTHS as readonly number[]).includes(w))
    .default(800),
});

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;

  app.get('/cities', async (_request, reply): Promise<CitiesResponse> => {
    const [cityRows, nRows] = await Promise.all([
      ctx.db.select().from(cities).where(eq(cities.active, true)).orderBy(asc(cities.sortOrder)),
      ctx.db
        .select()
        .from(neighbourhoods)
        .where(eq(neighbourhoods.active, true))
        .orderBy(asc(neighbourhoods.nameAr)),
    ]);
    reply.header('cache-control', 'public, max-age=300');
    return cityRows.map((c) => ({
      id: c.id,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      neighbourhoods: nRows
        .filter((n) => n.cityId === c.id)
        .map((n) => ({ id: n.id, nameAr: n.nameAr, nameEn: n.nameEn })),
    }));
  });

  // Who may see a picture:
  //  - avatars: everyone (they appear next to listings);
  //  - listing photos: everyone while the listing is public, otherwise only the seller
  //    (drafts, listings under review, and photos not yet attached to a listing).
  // Images get their own, higher limit: one page of listings loads ~20 of them.
  app.get(
    '/media/:id',
    { config: { rateLimit: { max: 3000, timeWindow: 60_000 } } },
    async (request, reply) => {
      const { id } = mediaParams.parse(request.params);
      const { w } = mediaQuery.parse(request.query);
      const [row] = await ctx.db
        .select({
          kind: media.kind,
          ownerId: media.ownerId,
          storageKey: media.storageKey,
          mime: media.mime,
          listingStatus: listings.status,
        })
        .from(media)
        .leftJoin(listingPhotos, eq(listingPhotos.mediaId, media.id))
        .leftJoin(listings, eq(listings.id, listingPhotos.listingId))
        .where(and(eq(media.id, id), eq(media.status, 'ready')));
      if (!row) throw new AppError('not_found');

      let key = row.storageKey;
      let cacheControl = 'public, max-age=31536000, immutable';
      if (row.kind === 'listing_photo') {
        const isPublic = row.listingStatus !== null && isPubliclyVisible(row.listingStatus);
        const isOwner = request.auth?.userId === row.ownerId;
        if (!isPublic && !isOwner) throw new AppError('not_found');
        key = photoKey(row.storageKey, w);
        // Short public caching: a listing can be hidden later and its photos must follow.
        cacheControl = isPublic ? 'public, max-age=3600' : 'private, no-store';
      }

      const object = await ctx.storage.get(key);
      if (!object) throw new AppError('not_found');

      return reply
        .header('content-type', row.mime)
        .header('cache-control', cacheControl)
        .header('cross-origin-resource-policy', 'same-site')
        .send(object.body);
    },
  );
}
