import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  boolean,
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
export const mediaKind = pgEnum('media_kind', ['avatar']);
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
