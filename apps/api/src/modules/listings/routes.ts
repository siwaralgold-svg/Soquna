import {
  listingActionInput,
  listingInput,
  listingSearchQuery,
  reportInput,
  updateListingInput,
} from '@souqna/contracts';
import { favourites, listingReports, listings, users } from '@souqna/db';
import { nextListingStatus } from '@souqna/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../../audit';
import { AppError } from '../../lib/errors';
import { IMAGE_UPLOAD_MAX_BYTES } from '../../lib/images';
import { idempotency } from '../../plugins/idempotency';
import { requireAuth } from '../auth/session';
import { storePhoto } from './photos';
import {
  categoryTree,
  favouriteListings,
  findVisibleListing,
  loadListingDetail,
  searchListings,
  sellerListings,
} from './queries';
import { applySellerAction, createListing, updateListing } from './service';

const idParams = z.object({ id: z.uuid() });

/** Distinct open reports that automatically send a listing back to moderation. */
export const REPORTS_BEFORE_REVIEW = 3;

export async function listingRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  const idem = idempotency(app);

  async function requireCompleteProfile(userId: string) {
    const [user] = await ctx.db
      .select({ displayName: users.displayName, cityId: users.cityId })
      .from(users)
      .where(eq(users.id, userId));
    if (!user?.displayName || !user.cityId) throw new AppError('forbidden');
  }

  app.get('/categories', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return categoryTree(ctx);
  });

  app.get('/listings', async (request) =>
    searchListings(ctx, listingSearchQuery.parse(request.query)),
  );

  app.get('/listings/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return loadListingDetail(ctx, id, request.auth?.userId ?? null);
  });

  app.post(
    '/listing-photos',
    { config: { rateLimit: { max: 120, timeWindow: 60 * 60 * 1000 } } },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      const file = await request.file({
        limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES, files: 1, fields: 0 },
      });
      if (!file) throw new AppError('upload_invalid');
      const photo = await storePhoto(ctx, userId, 'listing_photo', await file.toBuffer());
      return reply.status(201).send(photo);
    },
  );

  app.post(
    '/listings',
    {
      config: { rateLimit: { max: 30, timeWindow: 60 * 60 * 1000 } },
      preHandler: idem.preHandler,
      onSend: idem.onSend,
    },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      await requireCompleteProfile(userId);
      const data = listingInput.parse(request.body);
      const id = await createListing(ctx, userId, data, request.ip);
      return reply.status(201).send(await loadListingDetail(ctx, id, userId));
    },
  );

  app.put('/listings/:id', async (request) => {
    const { userId } = requireAuth(request);
    const { id } = idParams.parse(request.params);
    const data = updateListingInput.parse(request.body);
    await updateListing(ctx, userId, id, data, request.ip);
    return loadListingDetail(ctx, id, userId);
  });

  app.post('/listings/:id/actions', async (request) => {
    const { userId } = requireAuth(request);
    const { id } = idParams.parse(request.params);
    const { action } = listingActionInput.parse(request.body);
    const status = await applySellerAction(ctx, userId, id, action);
    return { status };
  });

  app.get('/me/listings', async (request) => sellerListings(ctx, requireAuth(request).userId));

  app.get('/me/favourites', async (request) => favouriteListings(ctx, requireAuth(request).userId));

  app.put('/listings/:id/favourite', async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = idParams.parse(request.params);
    await findVisibleListing(ctx, id);
    await ctx.db.insert(favourites).values({ userId, listingId: id }).onConflictDoNothing();
    return reply.status(204).send();
  });

  app.delete('/listings/:id/favourite', async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = idParams.parse(request.params);
    await ctx.db
      .delete(favourites)
      .where(and(eq(favourites.userId, userId), eq(favourites.listingId, id)));
    return reply.status(204).send();
  });

  app.post(
    '/listings/:id/report',
    { config: { rateLimit: { max: 20, timeWindow: 60 * 60 * 1000 } } },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      const { id } = idParams.parse(request.params);
      const body = reportInput.parse(request.body);
      const listing = await findVisibleListing(ctx, id);
      if (listing.sellerId === userId) throw new AppError('forbidden');

      const [created] = await ctx.db
        .insert(listingReports)
        .values({ listingId: id, reporterId: userId, reason: body.reason, note: body.note })
        .onConflictDoNothing()
        .returning({ id: listingReports.id });
      if (!created) return reply.status(204).send();

      await writeAudit(ctx, {
        actorId: userId,
        actorRole: 'user',
        action: 'listing.reported',
        targetType: 'listing',
        targetId: id,
        ip: request.ip,
        metadata: { reason: body.reason },
      });

      // Enough independent reports hide the listing until a moderator looks at it.
      const flagged = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            status: listings.status,
            open: sql<number>`(select count(*)::int from ${listingReports} where ${listingReports.listingId} = ${id} and ${listingReports.status} = 'open')`,
          })
          .from(listings)
          .where(eq(listings.id, id))
          .for('update', { of: listings });
        if (!row || row.open < REPORTS_BEFORE_REVIEW) return false;
        if (row.status !== 'active' && row.status !== 'paused') return false;
        await tx
          .update(listings)
          .set({
            status: nextListingStatus(row.status, 'flag_for_review', 'system'),
            version: sql`${listings.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(listings.id, id));
        return true;
      });
      if (flagged) {
        await writeAudit(ctx, {
          actorId: null,
          actorRole: 'system',
          action: 'listing.flagged_by_reports',
          targetType: 'listing',
          targetId: id,
        });
      }
      return reply.status(204).send();
    },
  );
}
