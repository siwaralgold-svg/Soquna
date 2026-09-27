import { LISTING_CONDITIONS, LISTING_STATUSES } from '@souqna/domain';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const userStatus = pgEnum('user_status', ['active', 'suspended', 'banned', 'deleted']);
export const trustLevel = pgEnum('trust_level', ['phone_verified', 'id_verified', 'trusted']);
export const staffRole = pgEnum('staff_role', [
  'courier',
  'moderator',
  'finance',
  'admin',
  'verifier',
]);
export const mediaKind = pgEnum('media_kind', ['avatar', 'listing_photo']);
export const mediaStatus = pgEnum('media_status', ['ready', 'deleted']);

export const cities = pgTable('cities', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  active: boolean('active').notNull().default(true),
  sortOrder: smallint('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const neighbourhoods = pgTable(
  'neighbourhoods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id),
    slug: text('slug').notNull(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('neighbourhoods_city_slug_uq').on(t.cityId, t.slug)],
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** HMAC-SHA256 of the E.164 number, used for login lookup. */
  phoneHash: bytea('phone_hash').notNull().unique(),
  /** AES-256-GCM encrypted E.164 number. */
  phoneEnc: bytea('phone_enc').notNull(),
  displayName: text('display_name'),
  cityId: uuid('city_id').references(() => cities.id),
  neighbourhoodId: uuid('neighbourhood_id').references(() => neighbourhoods.id),
  avatarMediaId: uuid('avatar_media_id').references((): AnyPgColumn => media.id),
  status: userStatus('status').notNull().default('active'),
  trustLevel: trustLevel('trust_level').notNull().default('phone_verified'),
  createdAt: createdAt(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  deletedAt: tstz('deleted_at'),
});

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: staffRole('role').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** SHA-256 of the random session token; the token itself is only in the cookie. */
    tokenHash: bytea('token_hash').notNull().unique(),
    deviceLabel: text('device_label').notNull(),
    deviceFpHash: bytea('device_fp_hash'),
    ipHash: bytea('ip_hash'),
    mfaVerifiedAt: tstz('mfa_verified_at'),
    createdAt: createdAt(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    index('sessions_user_active_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneHash: bytea('phone_hash').notNull(),
    /** Encrypted number, needed to create the user when the code is verified. */
    phoneEnc: bytea('phone_enc').notNull(),
    codeHash: bytea('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    ipHash: bytea('ip_hash'),
    createdAt: createdAt(),
    expiresAt: tstz('expires_at').notNull(),
    consumedAt: tstz('consumed_at'),
  },
  (t) => [index('otp_challenges_phone_idx').on(t.phoneHash, t.createdAt)],
);

export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  kind: mediaKind('kind').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  sha256: bytea('sha256').notNull(),
  /** Widths of the stored variants (listing photos: `${storageKey}/${width}.webp`). */
  sizes: integer('sizes').array(),
  status: mediaStatus('status').notNull().default('ready'),
  createdAt: createdAt(),
});

/** Append-only (enforced by trigger in migration 0001). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    actorId: uuid('actor_id'),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    ipHash: bytea('ip_hash'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_actor_idx').on(t.actorId, t.createdAt),
    index('audit_log_target_idx').on(t.targetType, t.targetId),
  ],
);

export const listingStatus = pgEnum('listing_status', LISTING_STATUSES);
export const listingCondition = pgEnum('listing_condition', LISTING_CONDITIONS);
export const screenAction = pgEnum('screen_action', ['block', 'review']);
export const reportReason = pgEnum('report_reason', [
  'prohibited',
  'scam',
  'wrong_category',
  'offensive',
  'duplicate',
  'other',
]);
export const reportStatus = pgEnum('report_status', ['open', 'actioned', 'dismissed']);

/** Admin-editable category tree (two levels). */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
    slug: text('slug').notNull().unique(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('categories_parent_idx').on(t.parentId)],
);

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    title: text('title').notNull(),
    description: text('description').notNull(),
    /** Integer minor units (piastres). Never a float. */
    priceMinor: bigint('price_minor', { mode: 'bigint' }).notNull(),
    negotiable: boolean('negotiable').notNull().default(false),
    condition: listingCondition('condition').notNull(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id),
    neighbourhoodId: uuid('neighbourhood_id').references(() => neighbourhoods.id),
    status: listingStatus('status').notNull().default('draft'),
    /** Moderator's reason for rejecting/removing; shown to the seller only. */
    moderationNote: text('moderation_note'),
    searchVector: tsvector('search_vector')
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('simple', souqna_normalize(title)), 'A') || setweight(to_tsvector('simple', souqna_normalize(description)), 'B')`,
      ),
    version: integer('version').notNull().default(1),
    publishedAt: tstz('published_at'),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('listings_seller_idx').on(t.sellerId, t.createdAt),
    index('listings_public_idx').on(t.status, t.publishedAt),
    index('listings_category_idx').on(t.categoryId),
    index('listings_city_idx').on(t.cityId),
    index('listings_price_idx').on(t.priceMinor),
    index('listings_search_idx').using('gin', t.searchVector),
    check('listings_price_positive', sql`${t.priceMinor} > 0`),
  ],
);

export const listingPhotos = pgTable(
  'listing_photos',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    /** Unique: a photo belongs to exactly one listing. */
    mediaId: uuid('media_id')
      .notNull()
      .unique()
      .references(() => media.id),
    position: smallint('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.listingId, t.mediaId] }),
    uniqueIndex('listing_photos_position_uq').on(t.listingId, t.position),
  ],
);

export const favourites = pgTable(
  'favourites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] })],
);

export const listingReports = pgTable(
  'listing_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id),
    reason: reportReason('reason').notNull(),
    note: text('note'),
    status: reportStatus('status').notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('listing_reports_once_uq').on(t.listingId, t.reporterId)],
);

/** Keyword pre-screen for the prohibited-items policy (admin-editable). */
export const prohibitedTerms = pgTable('prohibited_terms', {
  id: uuid('id').primaryKey().defaultRandom(),
  term: text('term').notNull().unique(),
  action: screenAction('action').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

/** Stored responses for writes sent with an Idempotency-Key header. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    key: text('key').notNull(),
    route: text('route').notNull(),
    requestHash: bytea('request_hash').notNull(),
    statusCode: integer('status_code'),
    response: jsonb('response'),
    createdAt: createdAt(),
    completedAt: tstz('completed_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);
