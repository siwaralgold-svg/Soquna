import type {
  ChatMessage,
  ConversationSummary,
  MessagesPage,
  OfferAction,
  sendMessageInput,
} from '@souqna/contracts';
import { REALTIME_EVENTS } from '@souqna/contracts/constants';
import {
  conversations,
  fraudFlags,
  listingPhotos,
  listings,
  media,
  messages,
  offers,
  users,
} from '@souqna/db';
import {
  effectiveOfferStatus,
  isValidOfferAmount,
  nextOfferStatus,
  OFFER_TTL_HOURS,
  OfferTransitionError,
  prepareChatText,
  type ChatFlag,
  type OfferStatus,
} from '@souqna/domain';
import { and, asc, desc, eq, gt, lt, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { mediaUrl } from '../profile/routes';

export const PAGE_SIZE = 30;
/** New conversations a user may start per 24 hours (anti-spam). */
export const NEW_CHATS_PER_DAY = 30;

export interface ConversationAccess {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  role: 'buyer' | 'seller';
}

/**
 * Object-level check for every chat route: the caller must be the buyer or the seller of the
 * conversation. Anyone else gets the same answer as for a conversation that doesn't exist.
 */
export async function conversationFor(
  ctx: AppContext,
  conversationId: string,
  userId: string,
): Promise<ConversationAccess> {
  const [row] = await ctx.db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId)),
      ),
    );
  if (!row) throw new AppError('not_found');
  return { ...row, role: row.buyerId === userId ? 'buyer' : 'seller' };
}

export async function startConversation(
  ctx: AppContext,
  buyerId: string,
  listingId: string,
): Promise<string> {
  const [listing] = await ctx.db
    .select({ sellerId: listings.sellerId, status: listings.status })
    .from(listings)
    .where(eq(listings.id, listingId));
  if (!listing || listing.status !== 'active') throw new AppError('listing_unavailable');
  if (listing.sellerId === buyerId) throw new AppError('forbidden');

  const [existing] = await ctx.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.listingId, listingId), eq(conversations.buyerId, buyerId)));
  if (existing) return existing.id;

  const [{ recent }] = (await ctx.db
    .select({ recent: sql<number>`count(*)::int` })
    .from(conversations)
    .where(
      and(
        eq(conversations.buyerId, buyerId),
        gt(conversations.createdAt, sql`now() - interval '24 hours'`),
      ),
    )) as [{ recent: number }];
  if (recent >= NEW_CHATS_PER_DAY) throw new AppError('chat_limit_reached');

  const [created] = await ctx.db
    .insert(conversations)
    .values({ listingId, buyerId, sellerId: listing.sellerId })
    .onConflictDoNothing()
    .returning({ id: conversations.id });
  if (created) return created.id;
  // Lost a race with a parallel request from the same buyer: use the row it created.
  const [row] = await ctx.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.listingId, listingId), eq(conversations.buyerId, buyerId)));
  return row!.id;
}

const messageColumns = {
  id: messages.id,
  conversationId: messages.conversationId,
  senderId: messages.senderId,
  type: messages.type,
  body: messages.body,
  mediaId: messages.mediaId,
  flags: messages.flags,
  createdAt: messages.createdAt,
  offerId: offers.id,
  offerAmount: offers.amountMinor,
  offerStatus: offers.status,
  offerExpiresAt: offers.expiresAt,
};

type MessageRow = {
  id: bigint;
  conversationId: string;
  senderId: string;
  type: ChatMessage['type'];
  body: string | null;
  mediaId: string | null;
  flags: string[];
  createdAt: Date;
  offerId: string | null;
  offerAmount: bigint | null;
  offerStatus: OfferStatus | null;
  offerExpiresAt: Date | null;
};

function toMessage(row: MessageRow, now = new Date()): ChatMessage {
  return {
    id: row.id.toString(),
    conversationId: row.conversationId,
    senderId: row.senderId,
    type: row.type,
    text: row.body,
    photoId: row.mediaId,
    offer:
      row.offerId && row.offerAmount !== null && row.offerStatus && row.offerExpiresAt
        ? {
            id: row.offerId,
            amountMinor: row.offerAmount.toString(),
            status: effectiveOfferStatus(row.offerStatus, row.offerExpiresAt, now),
            expiresAt: row.offerExpiresAt.toISOString(),
          }
        : null,
    flags: row.flags as ChatFlag[],
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadMessage(ctx: AppContext, id: bigint): Promise<ChatMessage> {
  const [row] = await ctx.db
    .select(messageColumns)
    .from(messages)
    .leftJoin(offers, eq(offers.id, messages.offerId))
    .where(eq(messages.id, id));
  return toMessage(row as MessageRow);
}

/**
 * Newest page by default; `before` pages back through history; `after` fetches anything
 * newer (used to catch up after a reconnect). Always returned oldest-first.
 */
export async function listMessages(
  ctx: AppContext,
  conversationId: string,
  cursor: { before?: bigint; after?: bigint },
): Promise<MessagesPage> {
  const where = and(
    eq(messages.conversationId, conversationId),
    cursor.before !== undefined ? lt(messages.id, cursor.before) : undefined,
    cursor.after !== undefined ? gt(messages.id, cursor.after) : undefined,
  );
  const rows = await ctx.db
    .select(messageColumns)
    .from(messages)
    .leftJoin(offers, eq(offers.id, messages.offerId))
    .where(where)
    .orderBy(cursor.after !== undefined ? asc(messages.id) : desc(messages.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE) as MessageRow[];
  if (cursor.after === undefined) page.reverse();
  const now = new Date();
  return { items: page.map((r) => toMessage(r, now)), hasMore };
}

export async function sendMessage(
  ctx: AppContext,
  conv: ConversationAccess,
  senderId: string,
  input: z.output<typeof sendMessageInput>,
): Promise<ChatMessage> {
  const [listing] = await ctx.db
    .select({
      status: listings.status,
      priceMinor: listings.priceMinor,
      negotiable: listings.negotiable,
    })
    .from(listings)
    .where(eq(listings.id, conv.listingId));
  if (!listing || listing.status === 'removed' || listing.status === 'deleted') {
    throw new AppError('listing_unavailable');
  }

  const id = await ctx.db.transaction(async (tx) => {
    let values: typeof messages.$inferInsert;
    let flags: ChatFlag[] = [];
    if (input.type === 'text') {
      const prepared = prepareChatText(input.text);
      flags = prepared.flags;
      values = { conversationId: conv.id, senderId, type: 'text', body: prepared.text, flags };
    } else if (input.type === 'image') {
      // Must be the sender's own chat photo, not yet sent in any message.
      const [photo] = await tx
        .select({ id: media.id, used: messages.id })
        .from(media)
        .leftJoin(messages, eq(messages.mediaId, media.id))
        .where(
          and(
            eq(media.id, input.photoId),
            eq(media.ownerId, senderId),
            eq(media.kind, 'chat_photo'),
            eq(media.status, 'ready'),
          ),
        );
      if (!photo || photo.used !== null) {
        throw new AppError('validation_failed', { fields: { photoId: 'not_found' } });
      }
      values = { conversationId: conv.id, senderId, type: 'image', mediaId: photo.id };
    } else {
      if (conv.role !== 'buyer' || listing.status !== 'active' || !listing.negotiable) {
        throw new AppError('offer_not_allowed');
      }
      if (!isValidOfferAmount(input.amount, listing.priceMinor)) {
        throw new AppError('validation_failed', { fields: { amount: 'invalid_price' } });
      }
      // An old pending offer that has run out no longer blocks a new one.
      await tx
        .update(offers)
        .set({ status: 'expired' })
        .where(
          and(
            eq(offers.conversationId, conv.id),
            eq(offers.status, 'pending'),
            lt(offers.expiresAt, sql`now()`),
          ),
        );
      const [offer] = await tx
        .insert(offers)
        .values({
          conversationId: conv.id,
          listingId: conv.listingId,
          buyerId: senderId,
          amountMinor: input.amount,
          expiresAt: new Date(Date.now() + OFFER_TTL_HOURS * 3600_000),
        })
        .onConflictDoNothing()
        .returning({ id: offers.id });
      if (!offer) throw new AppError('conflict'); // an offer is already waiting for an answer
      values = { conversationId: conv.id, senderId, type: 'offer', offerId: offer.id };
    }

    const [row] = await tx.insert(messages).values(values).returning({ id: messages.id });
    await tx
      .update(conversations)
      .set({
        lastMessageAt: sql`now()`,
        ...(conv.role === 'buyer' ? { buyerReadAt: sql`now()` } : { sellerReadAt: sql`now()` }),
      })
      .where(eq(conversations.id, conv.id));

    for (const rule of flags) {
      await tx.insert(fraudFlags).values({
        userId: senderId,
        rule: `chat_${rule}`,
        targetType: 'message',
        targetId: row!.id.toString(),
      });
    }
    return row!.id;
  });

  const message = await loadMessage(ctx, id);
  ctx.realtime?.toUsers([conv.buyerId, conv.sellerId], REALTIME_EVENTS.message, message);
  return message;
}

export async function actOnOffer(
  ctx: AppContext,
  conv: ConversationAccess,
  offerId: string,
  action: OfferAction,
): Promise<ChatMessage> {
  const result = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: offers.status, expiresAt: offers.expiresAt, messageId: messages.id })
      .from(offers)
      .innerJoin(messages, eq(messages.offerId, offers.id))
      .where(and(eq(offers.id, offerId), eq(offers.conversationId, conv.id)))
      .for('update', { of: offers });
    if (!row) throw new AppError('not_found');

    // Record the expiry, then report the conflict once the transaction has committed.
    if (
      row.status === 'pending' &&
      effectiveOfferStatus(row.status, row.expiresAt, new Date()) === 'expired'
    ) {
      await tx.update(offers).set({ status: 'expired' }).where(eq(offers.id, offerId));
      return { messageId: row.messageId, expired: true };
    }

    let status: OfferStatus;
    try {
      status = nextOfferStatus(row.status, action, conv.role);
    } catch (err) {
      if (err instanceof OfferTransitionError) {
        throw new AppError(row.status === 'pending' ? 'forbidden' : 'conflict');
      }
      throw err;
    }

    if (status === 'accepted') {
      const [listing] = await tx
        .select({ status: listings.status })
        .from(listings)
        .where(eq(listings.id, conv.listingId));
      if (listing?.status !== 'active') throw new AppError('offer_not_allowed');
    }
    await tx
      .update(offers)
      .set({ status, respondedAt: sql`now()` })
      .where(eq(offers.id, offerId));
    return { messageId: row.messageId, expired: false };
  });

  const message = await loadMessage(ctx, result.messageId);
  ctx.realtime?.toUsers([conv.buyerId, conv.sellerId], REALTIME_EVENTS.messageUpdated, message);
  if (result.expired) throw new AppError('conflict');
  return message;
}

export async function markRead(ctx: AppContext, conv: ConversationAccess): Promise<void> {
  await ctx.db
    .update(conversations)
    .set(conv.role === 'buyer' ? { buyerReadAt: sql`now()` } : { sellerReadAt: sql`now()` })
    .where(eq(conversations.id, conv.id));
}

const unreadFor = (userId: string) => sql<number>`(
  select count(*)::int from ${messages} m
  where m.conversation_id = "conversations"."id"
    and m.sender_id <> ${userId}
    and m.created_at > case when "conversations"."buyer_id" = ${userId}
                            then "conversations"."buyer_read_at"
                            else "conversations"."seller_read_at" end)`;

export async function listConversations(
  ctx: AppContext,
  userId: string,
  onlyId?: string,
): Promise<ConversationSummary[]> {
  const rows = await ctx.db
    .select({
      id: conversations.id,
      buyerId: conversations.buyerId,
      lastMessageAt: conversations.lastMessageAt,
      listingId: listings.id,
      title: listings.title,
      priceMinor: listings.priceMinor,
      negotiable: listings.negotiable,
      status: listings.status,
      cover: sql<
        string | null
      >`(select lp.media_id from ${listingPhotos} lp where lp.listing_id = "listings"."id" order by lp.position limit 1)`,
      counterpartId: users.id,
      counterpartName: users.displayName,
      counterpartAvatar: users.avatarMediaId,
      lastType: sql<
        ChatMessage['type'] | null
      >`(select m.type from ${messages} m where m.conversation_id = "conversations"."id" order by m.id desc limit 1)`,
      lastBody: sql<
        string | null
      >`(select m.body from ${messages} m where m.conversation_id = "conversations"."id" order by m.id desc limit 1)`,
      lastSender: sql<
        string | null
      >`(select m.sender_id from ${messages} m where m.conversation_id = "conversations"."id" order by m.id desc limit 1)`,
      unread: unreadFor(userId),
    })
    .from(conversations)
    .innerJoin(listings, eq(listings.id, conversations.listingId))
    .innerJoin(
      users,
      sql`${users.id} = case when ${conversations.buyerId} = ${userId} then ${conversations.sellerId} else ${conversations.buyerId} end`,
    )
    .where(
      and(
        or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId)),
        onlyId ? eq(conversations.id, onlyId) : undefined,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt));

  return rows
    .filter((r) => r.lastType !== null || r.buyerId === userId)
    .map((r) => ({
      id: r.id,
      role: r.buyerId === userId ? 'buyer' : 'seller',
      listing: {
        id: r.listingId,
        title: r.title,
        priceMinor: r.priceMinor.toString(),
        negotiable: r.negotiable,
        status: r.status,
        coverPhotoId: r.cover,
      },
      counterpart: {
        id: r.counterpartId,
        displayName: r.counterpartName ?? '',
        avatarUrl: r.counterpartAvatar ? mediaUrl(r.counterpartAvatar) : null,
      },
      lastMessage: r.lastType
        ? { type: r.lastType, text: r.lastBody, senderId: r.lastSender! }
        : null,
      unread: r.unread,
      lastMessageAt: r.lastMessageAt.toISOString(),
    }));
}

export async function unreadTotal(ctx: AppContext, userId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ total: sql<number>`coalesce(sum(${unreadFor(userId)}), 0)::int` })
    .from(conversations)
    .where(or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId)));
  return row?.total ?? 0;
}
