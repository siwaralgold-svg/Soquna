import { PHOTO_WIDTHS, type listingInput } from '@souqna/contracts';
import {
  categories,
  cities,
  listingPhotos,
  listings,
  media,
  neighbourhoods,
  users,
  type Database,
} from '@souqna/db';
import {
  canSellerEdit,
  ListingTransitionError,
  nextListingStatus,
  type ListingEvent,
  type ListingStatus,
} from '@souqna/domain';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { writeAudit } from '../../audit';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { photoKey } from './photos';
import { screenListing } from './screening';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type ListingData = z.output<typeof listingInput>;

/** Anti-fraud limits on listings that are not finished (sold/removed/deleted). */
export const NEW_ACCOUNT_DAYS = 7;
export const NEW_ACCOUNT_MAX_OPEN_LISTINGS = 5;
export const MAX_OPEN_LISTINGS = 100;
const FINISHED: ListingStatus[] = ['sold', 'removed', 'deleted'];

/** Runs a status change through the listing state machine; illegal moves become 409s. */
function transition(from: ListingStatus, event: ListingEvent): ListingStatus {
  try {
    return nextListingStatus(from, event, 'seller');
  } catch (err) {
    if (err instanceof ListingTransitionError) throw new AppError('conflict');
    throw err;
  }
}

async function assertPlace(tx: Tx, data: ListingData): Promise<void> {
  const [category] = await tx
    .select({
      id: categories.id,
      hasChildren: sql<boolean>`exists (select 1 from ${categories} c where c.parent_id = ${data.categoryId} and c.active)`,
    })
    .from(categories)
    .where(and(eq(categories.id, data.categoryId), eq(categories.active, true)));
  if (!category || category.hasChildren) {
    throw new AppError('validation_failed', { fields: { categoryId: 'not_found' } });
  }

  const [city] = await tx
    .select({ id: cities.id })
    .from(cities)
    .where(and(eq(cities.id, data.cityId), eq(cities.active, true)));
  if (!city) throw new AppError('validation_failed', { fields: { cityId: 'not_found' } });

  if (data.neighbourhoodId) {
    const [n] = await tx
      .select({ id: neighbourhoods.id })
      .from(neighbourhoods)
      .where(
        and(
          eq(neighbourhoods.id, data.neighbourhoodId),
          eq(neighbourhoods.cityId, data.cityId),
          eq(neighbourhoods.active, true),
        ),
      );
    if (!n) throw new AppError('validation_failed', { fields: { neighbourhoodId: 'not_found' } });
  }
}

/**
 * Attaches photos in the given order. Each photo must be the seller's own listing photo, and
 * not already used by a different listing (object-level check: someone else's photo id is
 * treated exactly like one that doesn't exist). Returns storage keys of photos that were
 * detached, so the caller can delete them after commit.
 */
async function setPhotos(
  tx: Tx,
  sellerId: string,
  listingId: string,
  photoIds: string[],
): Promise<string[]> {
  if (photoIds.length > 0) {
    const owned = await tx
      .select({ id: media.id, attachedTo: listingPhotos.listingId })
      .from(media)
      .leftJoin(listingPhotos, eq(listingPhotos.mediaId, media.id))
      .where(
        and(
          inArray(media.id, photoIds),
          eq(media.ownerId, sellerId),
          eq(media.kind, 'listing_photo'),
          eq(media.status, 'ready'),
        ),
      )
      .for('update', { of: media });
    const usable = owned.filter((m) => m.attachedTo === null || m.attachedTo === listingId);
    if (usable.length !== photoIds.length) {
      throw new AppError('validation_failed', { fields: { photoIds: 'not_found' } });
    }
  }

  const previous = await tx
    .delete(listingPhotos)
    .where(eq(listingPhotos.listingId, listingId))
    .returning({ mediaId: listingPhotos.mediaId });
  if (photoIds.length > 0) {
    await tx
      .insert(listingPhotos)
      .values(photoIds.map((mediaId, position) => ({ listingId, mediaId, position })));
  }

  const removed = previous.filter((p) => !photoIds.includes(p.mediaId));
  if (removed.length === 0) return [];
  const deleted = await tx
    .update(media)
    .set({ status: 'deleted' })
    .where(
      inArray(
        media.id,
        removed.map((r) => r.mediaId),
      ),
    )
    .returning({ storageKey: media.storageKey });
  return deleted.map((d) => d.storageKey);
}

async function assertWithinLimits(tx: Tx, sellerId: string): Promise<void> {
  const [row] = await tx
    .select({
      open: sql<number>`(select count(*)::int from ${listings} where ${listings.sellerId} = ${sellerId} and ${notInArray(listings.status, FINISHED)})`,
      isNew: sql<boolean>`${users.createdAt} > now() - make_interval(days => ${NEW_ACCOUNT_DAYS})`,
    })
    .from(users)
    .where(eq(users.id, sellerId));
  const max = row?.isNew ? NEW_ACCOUNT_MAX_OPEN_LISTINGS : MAX_OPEN_LISTINGS;
  if (!row || row.open >= max) throw new AppError('listing_limit_reached');
}

/**
 * Decides the status after a seller saves or publishes, applying the keyword screen:
 * a `block` match rejects the request; a `review` match sends the listing to a moderator.
 */
async function decideStatus(
  ctx: AppContext,
  current: ListingStatus,
  data: ListingData,
): Promise<{ status: ListingStatus; matched: string[] }> {
  const screen = await screenListing(ctx, data);
  if (screen.action === 'block') throw new AppError('listing_prohibited');

  let status = current === 'rejected' ? transition(current, 'revise') : current;
  if (status === 'pending_review') return { status, matched: screen.matched };

  if (screen.action === 'review' && (data.publish || status !== 'draft')) {
    return { status: transition(status, 'flag_for_review'), matched: screen.matched };
  }
  if (data.publish) {
    if (status === 'draft') status = transition(status, 'publish');
    else if (status === 'paused') status = transition(status, 'resume');
  } else if (status === 'active') {
    status = transition(status, 'pause');
  }
  return { status, matched: [] };
}

export async function createListing(
  ctx: AppContext,
  sellerId: string,
  data: ListingData,
  ip: string,
): Promise<string> {
  const { status, matched } = await decideStatus(ctx, 'draft', data);
  const id = await ctx.db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, sellerId)).for('update');
    await assertWithinLimits(tx, sellerId);
    await assertPlace(tx, data);
    const [row] = await tx
      .insert(listings)
      .values({
        sellerId,
        categoryId: data.categoryId,
        title: data.title,
        description: data.description,
        priceMinor: data.price,
        negotiable: data.negotiable,
        condition: data.condition,
        cityId: data.cityId,
        neighbourhoodId: data.neighbourhoodId,
        status,
        publishedAt: status === 'active' ? new Date() : null,
      })
      .returning({ id: listings.id });
    await setPhotos(tx, sellerId, row!.id, data.photoIds);
    return row!.id;
  });

  if (status === 'pending_review') {
    await writeAudit(ctx, {
      actorId: sellerId,
      actorRole: 'user',
      action: 'listing.flagged_by_keywords',
      targetType: 'listing',
      targetId: id,
      ip,
      metadata: { matched },
    });
  }
  return id;
}

export async function updateListing(
  ctx: AppContext,
  sellerId: string,
  listingId: string,
  data: ListingData & { version: number },
  ip: string,
): Promise<void> {
  const [current] = await ctx.db
    .select({ status: listings.status })
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId)));
  if (!current || current.status === 'deleted') throw new AppError('not_found');
  if (!canSellerEdit(current.status)) throw new AppError('conflict');
  const { status, matched } = await decideStatus(ctx, current.status, data);

  const orphaned = await ctx.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        status: listings.status,
        version: listings.version,
        publishedAt: listings.publishedAt,
      })
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId)))
      .for('update');
    // Optimistic lock: the seller edited an out-of-date copy, or it changed meanwhile.
    if (!locked || locked.version !== data.version || locked.status !== current.status) {
      throw new AppError('conflict');
    }
    await assertPlace(tx, data);
    await tx
      .update(listings)
      .set({
        categoryId: data.categoryId,
        title: data.title,
        description: data.description,
        priceMinor: data.price,
        negotiable: data.negotiable,
        condition: data.condition,
        cityId: data.cityId,
        neighbourhoodId: data.neighbourhoodId,
        status,
        moderationNote: status === current.status ? undefined : null,
        publishedAt: status === 'active' ? (locked.publishedAt ?? new Date()) : locked.publishedAt,
        version: sql`${listings.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, listingId));
    return setPhotos(tx, sellerId, listingId, data.photoIds);
  });

  await Promise.all(orphaned.map((key) => deletePhotoObjects(ctx, key)));
  if (status === 'pending_review' && current.status !== 'pending_review') {
    await writeAudit(ctx, {
      actorId: sellerId,
      actorRole: 'user',
      action: 'listing.flagged_by_keywords',
      targetType: 'listing',
      targetId: listingId,
      ip,
      metadata: { matched },
    });
  }
}

/** Seller actions from the "my listings" screen: publish a draft, pause, resume, delete. */
export async function applySellerAction(
  ctx: AppContext,
  sellerId: string,
  listingId: string,
  action: 'publish' | 'pause' | 'resume' | 'delete',
): Promise<ListingStatus> {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: listings.status,
        title: listings.title,
        description: listings.description,
        publishedAt: listings.publishedAt,
        photos: sql<number>`(select count(*)::int from ${listingPhotos} where ${listingPhotos.listingId} = ${listingId})`,
      })
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId)))
      .for('update', { of: listings });
    if (!row || row.status === 'deleted') throw new AppError('not_found');

    let status = transition(row.status, action);
    if (action === 'publish' || action === 'resume') {
      // Terms may have changed since the listing was written, so screen again.
      const screen = await screenListing(ctx, row);
      if (screen.action === 'block') throw new AppError('listing_prohibited');
      if (screen.action === 'review') status = transition(row.status, 'flag_for_review');
      if (action === 'publish' && row.photos === 0) {
        throw new AppError('validation_failed', { fields: { photoIds: 'photo_required' } });
      }
    }

    await tx
      .update(listings)
      .set({
        status,
        publishedAt: status === 'active' ? (row.publishedAt ?? new Date()) : row.publishedAt,
        version: sql`${listings.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, listingId));
    return status;
  });
}

export async function deletePhotoObjects(ctx: AppContext, storageKey: string): Promise<void> {
  await Promise.all(
    PHOTO_WIDTHS.map((w) => ctx.storage.delete(photoKey(storageKey, w)).catch(() => {})),
  );
}
