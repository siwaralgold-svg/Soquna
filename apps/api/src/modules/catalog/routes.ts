import type { CitiesResponse } from '@souqna/contracts';
import { cities, media, neighbourhoods } from '@souqna/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors';

const mediaParams = z.object({ id: z.uuid() });

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

  // Avatars are public (they appear next to listings). Other media kinds will get their own
  // access policies when they are introduced; until then they are simply not served here.
  app.get('/media/:id', async (request, reply) => {
    const { id } = mediaParams.parse(request.params);
    const [row] = await ctx.db
      .select({ storageKey: media.storageKey, mime: media.mime })
      .from(media)
      .where(and(eq(media.id, id), eq(media.kind, 'avatar'), eq(media.status, 'ready')));
    if (!row) throw new AppError('not_found');

    const object = await ctx.storage.get(row.storageKey);
    if (!object) throw new AppError('not_found');

    return reply
      .header('content-type', row.mime)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('cross-origin-resource-policy', 'same-site')
      .send(object.body);
  });
}
