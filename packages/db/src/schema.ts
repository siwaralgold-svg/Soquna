import {
  DELIVERY_METHODS,
  LEDGER_ACCOUNTS,
  LISTING_CONDITIONS,
  LISTING_LOCKING_STATUSES,
  LISTING_STATUSES,
  OFFER_STATUSES,
  ORDER_ACTORS,
  ORDER_STATUSES,
  OWNED_ACCOUNTS,
  PAYMENT_METHODS,
} from '@souqna/domain';
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
  unique,
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
export const mediaKind = pgEnum('media_kind', [
  'avatar',
  'listing_photo',
  'chat_photo',
  'payment_proof',
]);
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

export const messageType = pgEnum('message_type', ['text', 'image', 'offer']);
export const offerStatus = pgEnum('offer_status', OFFER_STATUSES);
export const fraudFlagStatus = pgEnum('fraud_flag_status', ['open', 'cleared', 'actioned']);

/** One private conversation per (listing, buyer). The seller is the listing's seller. */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    lastMessageAt: tstz('last_message_at').notNull().defaultNow(),
    buyerReadAt: tstz('buyer_read_at').notNull().defaultNow(),
    sellerReadAt: tstz('seller_read_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('conversations_listing_buyer_uq').on(t.listingId, t.buyerId),
    index('conversations_buyer_idx').on(t.buyerId, t.lastMessageAt),
    index('conversations_seller_idx').on(t.sellerId, t.lastMessageAt),
    check('conversations_not_self', sql`${t.buyerId} <> ${t.sellerId}`),
  ],
);

export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    status: offerStatus('status').notNull().default('pending'),
    expiresAt: tstz('expires_at').notNull(),
    respondedAt: tstz('responded_at'),
    createdAt: createdAt(),
  },
  (t) => [
    // At most one open offer per conversation.
    uniqueIndex('offers_one_pending_uq')
      .on(t.conversationId)
      .where(sql`${t.status} = 'pending'`),
    check('offers_amount_positive', sql`${t.amountMinor} > 0`),
  ],
);

/**
 * Chat messages. Text is stored already masked (phone numbers and links replaced) while no
 * order exists, so the original contact details are never kept.
 */
export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    type: messageType('type').notNull(),
    body: text('body'),
    mediaId: uuid('media_id').references(() => media.id),
    offerId: uuid('offer_id').references(() => offers.id),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.id),
    // A photo belongs to exactly one message.
    uniqueIndex('messages_media_uq').on(t.mediaId),
  ],
);

/** Automatic fraud signals for the admin fraud queue (Phase 6). */
export const fraudFlags = pgTable(
  'fraud_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    rule: text('rule').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    status: fraudFlagStatus('status').notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [index('fraud_flags_user_idx').on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------------------
// Phase 4: orders, payments, ledger
// ---------------------------------------------------------------------------------------

/** TOTP second factor for staff (finance, admins). Enrolled from the command line. */
export const staffMfa = pgTable('staff_mfa', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  /** AES-256-GCM encrypted base32 secret. */
  secretEnc: bytea('secret_enc').notNull(),
  /** Last accepted 30-second step, so a code can't be used twice. */
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  createdAt: createdAt(),
});

const money = (name: string) => bigint(name, { mode: 'bigint' });

/**
 * Checkout settings (fees, limits, timers). Rows are never edited: a new row with a later
 * `effective_from` replaces the old one, and each order keeps the row it was priced with.
 */
export const orderConfigs = pgTable(
  'order_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    protectionFixedMinor: money('protection_fixed_minor').notNull(),
    protectionPctBps: integer('protection_pct_bps').notNull(),
    protectionCapMinor: money('protection_cap_minor').notNull(),
    courierFeeMinor: money('courier_fee_minor').notNull(),
    codMaxMinor: money('cod_max_minor').notNull(),
    newBuyerMaxMinor: money('new_buyer_max_minor').notNull(),
    newAccountDays: integer('new_account_days').notNull(),
    paymentHours: integer('payment_hours').notNull(),
    handoverHours: integer('handover_hours').notNull(),
    inspectionHours: integer('inspection_hours').notNull(),
    newSellerHoldDays: integer('new_seller_hold_days').notNull(),
    newSellerOrders: integer('new_seller_orders').notNull(),
    effectiveFrom: tstz('effective_from').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'order_configs_sane',
      sql`${t.protectionFixedMinor} >= 0 and ${t.protectionPctBps} between 0 and 10000
        and ${t.protectionCapMinor} >= 0 and ${t.courierFeeMinor} >= 0 and ${t.codMaxMinor} >= 0
        and ${t.newBuyerMaxMinor} > 0 and ${t.paymentHours} > 0 and ${t.handoverHours} > 0
        and ${t.inspectionHours} > 0 and ${t.newSellerHoldDays} >= 0 and ${t.newSellerOrders} >= 0`,
    ),
  ],
);

export const orderStatus = pgEnum('order_status', ORDER_STATUSES);
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS);
export const deliveryMethod = pgEnum('delivery_method', DELIVERY_METHODS);
export const orderActor = pgEnum('order_actor', ORDER_ACTORS);
export const paymentStatus = pgEnum('payment_status', ['submitted', 'verified', 'rejected']);
export const ledgerAccountCode = pgEnum('ledger_account_code', LEDGER_ACCOUNTS);

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Orders. `status` is only ever changed by transition() in apps/api/src/modules/orders,
 * which also writes order_events and the ledger in the same DB transaction.
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Short code people quote (e.g. in the bank transfer note): "SQ-7K3M9Q". */
    publicCode: text('public_code').notNull().unique(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    offerId: uuid('offer_id').references(() => offers.id),
    /** Assigned in Phase 5. */
    courierId: uuid('courier_id').references(() => users.id),
    status: orderStatus('status').notNull(),
    paymentMethod: paymentMethod('payment_method').notNull(),
    deliveryMethod: deliveryMethod('delivery_method').notNull(),
    itemMinor: money('item_minor').notNull(),
    deliveryMinor: money('delivery_minor').notNull(),
    protectionMinor: money('protection_minor').notNull(),
    totalMinor: money('total_minor').notNull(),
    configId: uuid('config_id')
      .notNull()
      .references(() => orderConfigs.id),
    /** Pay by then (for cash on delivery: the seller must confirm by then). */
    paymentDueAt: tstz('payment_due_at'),
    handoverDueAt: tstz('handover_due_at'),
    inspectionEndsAt: tstz('inspection_ends_at'),
    payoutHoldUntil: tstz('payout_hold_until'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One active order per listing: the database itself prevents selling an item twice.
    uniqueIndex('orders_one_active_per_listing_uq')
      .on(t.listingId)
      .where(sql`${t.status} in (${inList(LISTING_LOCKING_STATUSES)})`),
    index('orders_buyer_idx').on(t.buyerId, t.createdAt),
    index('orders_seller_idx').on(t.sellerId, t.createdAt),
    index('orders_payment_due_idx')
      .on(t.paymentDueAt)
      .where(sql`${t.paymentDueAt} is not null`),
    index('orders_handover_due_idx')
      .on(t.handoverDueAt)
      .where(sql`${t.handoverDueAt} is not null`),
    index('orders_inspection_idx')
      .on(t.inspectionEndsAt)
      .where(sql`${t.inspectionEndsAt} is not null`),
    index('orders_payout_hold_idx')
      .on(t.payoutHoldUntil)
      .where(sql`${t.payoutHoldUntil} is not null`),
    check('orders_not_self', sql`${t.buyerId} <> ${t.sellerId}`),
    check(
      'orders_amounts',
      sql`${t.itemMinor} > 0 and ${t.deliveryMinor} >= 0 and ${t.protectionMinor} >= 0
        and ${t.totalMinor} = ${t.itemMinor} + ${t.deliveryMinor} + ${t.protectionMinor}`,
    ),
  ],
);

/** Every status change: who, when, why. Append-only (trigger in migration 0006). */
export const orderEvents = pgTable(
  'order_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    event: text('event').notNull(),
    actorType: orderActor('actor_type').notNull(),
    actorId: uuid('actor_id'),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_events_order_idx').on(t.orderId, t.id),
    uniqueIndex('order_events_idem_uq')
      .on(t.orderId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

/** A payment claim: a bank transfer reference to verify, or a provider's confirmation. */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    method: paymentMethod('method').notNull(),
    amountMinor: money('amount_minor').notNull(),
    /** Normalised (see normalizePaymentReference). */
    reference: text('reference').notNull(),
    proofMediaId: uuid('proof_media_id').references(() => media.id),
    status: paymentStatus('status').notNull().default('submitted'),
    submittedBy: uuid('submitted_by').references(() => users.id),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: tstz('reviewed_at'),
    rejectionReason: text('rejection_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    // The same transfer can't be claimed twice (unless finance rejected the claim).
    uniqueIndex('payments_reference_uq')
      .on(t.reference)
      .where(sql`${t.status} <> 'rejected'`),
    // One claim under review per order at a time.
    uniqueIndex('payments_one_open_per_order_uq')
      .on(t.orderId)
      .where(sql`${t.status} = 'submitted'`),
    index('payments_status_idx').on(t.status, t.createdAt),
    uniqueIndex('payments_proof_uq').on(t.proofMediaId),
    check('payments_amount_positive', sql`${t.amountMinor} > 0`),
  ],
);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: ledgerAccountCode('code').notNull(),
    /** The person for per-person accounts (seller_balance:{id}…); null for platform accounts. */
    ownerId: uuid('owner_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('ledger_accounts_code_owner_uq').on(t.code, t.ownerId).nullsNotDistinct(),
    check(
      'ledger_accounts_owner',
      sql`(${t.code} in (${inList(OWNED_ACCOUNTS)})) = (${t.ownerId} is not null)`,
    ),
  ],
);

/** One movement of money. Append-only; its entries must sum to zero (deferred trigger). */
export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The order event (or payout action) that caused it. */
    kind: text('kind').notNull(),
    orderId: uuid('order_id').references(() => orders.id),
    paymentId: uuid('payment_id').references(() => payments.id),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('ledger_transactions_order_idx').on(t.orderId)],
);

/** + debit / − credit, never zero. Append-only. */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => ledgerTransactions.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    amountMinor: money('amount_minor').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_entries_account_idx').on(t.accountId),
    index('ledger_entries_transaction_idx').on(t.transactionId),
    check('ledger_entries_non_zero', sql`${t.amountMinor} <> 0`),
  ],
);
