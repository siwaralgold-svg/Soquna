import type {
  CategoryTree,
  ListingCard,
  ListingDetail,
  ListingPage,
  listingSearchQuery,
} from '@souqna/contracts';
import {
  categories,
  cities,
  favourites,
  listingPhotos,
  listings,
  neighbourhoods,
  users,
} from '@souqna/db';
import {
  isPubliclyVisible,
  parsePriceInput,
  toPrefixTsQuery,
  type ListingStatus,
} from '@souqna/domain';
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { mediaUrl } from '../profile/routes';

export const PAGE_SIZE = 20;

// Correlated subqueries spell out "listings"."id": Drizzle drops the table prefix on columns in
// queries without joins, and a bare "id" would bind to the subquery's own table.
const coverPhoto = sql<
  string | null
>`(select lp.media_id from ${listingPhotos} lp where lp.listing_id = "listings"."id" order by lp.position limit 1)`;

const cardColumns = {
  id: listings.id,
  title: listings.title,
  priceMinor: listings.priceMinor,
  negotiable: listings.negotiable,
  condition: listings.condition,
  status: listings.status,
  publishedAt: listings.publishedAt,
  cityId: cities.id,
  cityAr: cities.nameAr,
  cityEn: cities.nameEn,
  coverPhotoId: coverPhoto,
};

type CardRow = {
  id: string;
  title: string;
  priceMinor: bigint;
  negotiable: boolean;
  condition: ListingCard['condition'];
  status: ListingStatus;
  publishedAt: Date | null;
  cityId: string;
  cityAr: string;
  cityEn: string;
  coverPhotoId: string | null;
};

function toCard(r: CardRow): ListingCard {
  return {
    id: r.id,
    title: r.title,
    priceMinor: r.priceMinor.toString(),
    negotiable: r.negotiable,
    condition: r.condition,
    status: r.status,
    city: { id: r.cityId, nameAr: r.cityAr, nameEn: r.cityEn },
    coverPhotoId: r.coverPhotoId,
    publishedAt: r.publishedAt?.toISOString() ?? null,
  };
}

/** Public search: active listings only. */
export async function searchListings(
  ctx: AppContext,
  query: z.output<typeof listingSearchQuery>,
): Promise<ListingPage> {
  const page = query.page ?? 0;
  const tsQuery = query.q ? toPrefixTsQuery(query.q) : null;
  const tsq = tsQuery ? sql`to_tsquery('simple', ${tsQuery})` : null;

  const filters: (SQL | undefined)[] = [eq(listings.status, 'active')];
  if (tsq) filters.push(sql`${listings.searchVector} @@ ${tsq}`);
  if (query.category) {
    filters.push(
      sql`${listings.categoryId} in (select id from ${categories} where id = ${query.category} or parent_id = ${query.category})`,
    );
  }
  if (query.city) filters.push(eq(listings.cityId, query.city));
  const min = query.minPrice ? parsePriceInput(query.minPrice) : null;
  const max = query.maxPrice ? parsePriceInput(query.maxPrice) : null;
  if (min !== null) filters.push(sql`${listings.priceMinor} >= ${min}`);
  if (max !== null) filters.push(sql`${listings.priceMinor} <= ${max}`);
  if (query.condition.length > 0) filters.push(inArray(listings.condition, query.condition));

  const sort = query.sort ?? (tsq ? 'relevance' : 'newest');
  const order: SQL[] = {
    relevance: tsq
      ? [sql`ts_rank(${listings.searchVector}, ${tsq}) desc`, desc(listings.publishedAt)]
      : [desc(listings.publishedAt)],
    newest: [desc(listings.publishedAt)],
    price_asc: [asc(listings.priceMinor), desc(listings.publishedAt)],
    price_desc: [desc(listings.priceMinor), desc(listings.publishedAt)],
  }[sort];

  const rows = await ctx.db
    .select(cardColumns)
    .from(listings)
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .where(and(...filters))
    .orderBy(...order, desc(listings.id))
    .limit(PAGE_SIZE + 1)
    .offset(page * PAGE_SIZE);

  return {
    items: rows.slice(0, PAGE_SIZE).map(toCard),
    page,
    hasMore: rows.length > PAGE_SIZE,
  };
}

export async function sellerListings(ctx: AppContext, sellerId: string): Promise<ListingCard[]> {
  const rows = await ctx.db
    .select(cardColumns)
    .from(listings)
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .where(and(eq(listings.sellerId, sellerId), ne(listings.status, 'deleted')))
    .orderBy(desc(listings.updatedAt));
  return rows.map(toCard);
}

export async function favouriteListings(ctx: AppContext, userId: string): Promise<ListingCard[]> {
  const rows = await ctx.db
    .select(cardColumns)
    .from(favourites)
    .innerJoin(listings, eq(listings.id, favourites.listingId))
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .where(
      and(eq(favourites.userId, userId), inArray(listings.status, ['active', 'reserved', 'sold'])),
    )
    .orderBy(desc(favourites.createdAt));
  return rows.map(toCard);
}

/**
 * Listing page. Drafts, listings under review, rejected/removed/deleted listings are only
 * visible to their seller; for anyone else they behave exactly like a missing listing.
 */
export async function loadListingDetail(
  ctx: AppContext,
  listingId: string,
  viewerId: string | null,
): Promise<ListingDetail> {
  const parent = alias(categories, 'parent');
  const [row] = await ctx.db
    .select({
      l: listings,
      categoryId: categories.id,
      categoryAr: categories.nameAr,
      categoryEn: categories.nameEn,
      parentId: parent.id,
      parentAr: parent.nameAr,
      parentEn: parent.nameEn,
      cityId: cities.id,
      cityAr: cities.nameAr,
      cityEn: cities.nameEn,
      nId: neighbourhoods.id,
      nAr: neighbourhoods.nameAr,
      nEn: neighbourhoods.nameEn,
      sellerName: users.displayName,
      sellerAvatar: users.avatarMediaId,
      sellerSince: users.createdAt,
      isFavourite: sql<boolean>`exists (select 1 from ${favourites} f where f.listing_id = ${listingId} and f.user_id = ${viewerId})`,
    })
    .from(listings)
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .leftJoin(parent, eq(parent.id, categories.parentId))
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .leftJoin(neighbourhoods, eq(neighbourhoods.id, listings.neighbourhoodId))
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(eq(listings.id, listingId));

  if (!row || row.l.status === 'deleted') throw new AppError('not_found');
  const isOwner = viewerId !== null && row.l.sellerId === viewerId;
  if (!isOwner && (!isPubliclyVisible(row.l.status) || row.sellerName === null)) {
    throw new AppError('not_found');
  }

  const photos = await ctx.db
    .select({ id: listingPhotos.mediaId })
    .from(listingPhotos)
    .where(eq(listingPhotos.listingId, listingId))
    .orderBy(asc(listingPhotos.position));

  const l = row.l;
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    priceMinor: l.priceMinor.toString(),
    negotiable: l.negotiable,
    condition: l.condition,
    status: l.status,
    category: {
      id: row.categoryId,
      nameAr: row.categoryAr,
      nameEn: row.categoryEn,
      parent: row.parentId
        ? { id: row.parentId, nameAr: row.parentAr!, nameEn: row.parentEn! }
        : null,
    },
    city: { id: row.cityId, nameAr: row.cityAr, nameEn: row.cityEn },
    neighbourhood: row.nId ? { id: row.nId, nameAr: row.nAr!, nameEn: row.nEn! } : null,
    photos,
    seller: {
      id: l.sellerId,
      displayName: row.sellerName ?? '',
      avatarUrl: row.sellerAvatar ? mediaUrl(row.sellerAvatar) : null,
      memberSince: row.sellerSince.toISOString(),
    },
    publishedAt: l.publishedAt?.toISOString() ?? null,
    updatedAt: l.updatedAt.toISOString(),
    version: l.version,
    isOwner,
    isFavourite: row.isFavourite,
    moderationNote: isOwner ? l.moderationNote : null,
  };
}

export async function categoryTree(ctx: AppContext): Promise<CategoryTree> {
  const rows = await ctx.db
    .select()
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.sortOrder));
  const named = (c: (typeof rows)[number]) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn });
  return rows
    .filter((c) => c.parentId === null)
    .map((c) => ({ ...named(c), children: rows.filter((k) => k.parentId === c.id).map(named) }));
}

/** Used by favourites and reports: the listing must be visible to the public. */
export async function findVisibleListing(
  ctx: AppContext,
  listingId: string,
): Promise<{ id: string; sellerId: string; status: ListingStatus }> {
  const [row] = await ctx.db
    .select({ id: listings.id, sellerId: listings.sellerId, status: listings.status })
    .from(listings)
    .where(
      and(eq(listings.id, listingId), inArray(listings.status, ['active', 'reserved', 'sold'])),
    );
  if (!row) throw new AppError('not_found');
  return row;
}
