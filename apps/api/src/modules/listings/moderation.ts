import { listingReports, listings, users, type Database } from '@souqna/db';
import { nextListingStatus } from '@souqna/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { writeAudit } from '../../audit';
import { AppError } from '../../lib/errors';

export type ModerationAction = 'approve' | 'reject' | 'remove';

export interface PendingListing {
  id: string;
  title: string;
  description: string;
  sellerName: string | null;
  openReports: number;
  updatedAt: Date;
}

/** Listings waiting for a moderator (keyword hits and listings with too many reports). */
export async function listPendingListings(db: Database): Promise<PendingListing[]> {
  return db
    .select({
      id: listings.id,
      title: listings.title,
      description: listings.description,
      sellerName: users.displayName,
      openReports: sql<number>`(select count(*)::int from ${listingReports} r where r.listing_id = "listings"."id" and r.status = 'open')`,
      updatedAt: listings.updatedAt,
    })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(eq(listings.status, 'pending_review'))
    .orderBy(asc(listings.updatedAt));
}

/**
 * Applies a moderator decision through the listing state machine and closes the listing's
 * open reports. `note` is shown to the seller and is required for reject/remove.
 * Every decision goes to the audit log.
 */
export async function moderateListing(
  db: Database,
  input: {
    listingId: string;
    action: ModerationAction;
    note?: string;
    moderatorId: string | null;
    via: string;
  },
): Promise<void> {
  if (input.action !== 'approve' && !input.note?.trim()) {
    throw new AppError('validation_failed', { fields: { note: 'required' } });
  }

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: listings.status, publishedAt: listings.publishedAt })
      .from(listings)
      .where(eq(listings.id, input.listingId))
      .for('update');
    if (!row) throw new AppError('not_found');

    const status = nextListingStatus(row.status, input.action, 'moderator');
    await tx
      .update(listings)
      .set({
        status,
        moderationNote: input.action === 'approve' ? null : input.note!.trim(),
        publishedAt: status === 'active' ? (row.publishedAt ?? new Date()) : row.publishedAt,
        version: sql`${listings.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, input.listingId));
    await tx
      .update(listingReports)
      .set({ status: input.action === 'approve' ? 'dismissed' : 'actioned' })
      .where(and(eq(listingReports.listingId, input.listingId), eq(listingReports.status, 'open')));

    await writeAudit(
      { db: tx },
      {
        actorId: input.moderatorId,
        actorRole: 'moderator',
        action: `listing.${input.action}`,
        targetType: 'listing',
        targetId: input.listingId,
        metadata: { via: input.via, from: row.status, to: status },
      },
    );
  });
}
