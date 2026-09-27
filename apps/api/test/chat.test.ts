import type { AddressInfo } from 'node:net';
import { fraudFlags, messages, offers } from '@souqna/db';
import { eq, sql } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ORIGIN, createTestApp, randomIp, writeHeaders, type TestApp } from './helpers';
import {
  loadPlaces,
  newKey,
  photoBytes,
  publishListing,
  seller,
  type Places,
} from './listing-helpers';

let t: TestApp;
let places: Places;

beforeAll(async () => {
  t = await createTestApp();
  places = await loadPlaces(t);
});
afterAll(async () => {
  await t.close();
});

const req = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object, key?: string) =>
  t.app.inject({
    method,
    url,
    headers: {
      ...(method === 'POST' ? writeHeaders : {}),
      cookie,
      ...(key ? { 'idempotency-key': key } : {}),
    },
    payload,
    remoteAddress: randomIp(),
  });

async function setup(overrides: { negotiable?: boolean; price?: string } = {}) {
  const sellerCookie = await seller(t, places, 'Seller');
  const buyerCookie = await seller(t, places, 'Buyer');
  const listingId = await publishListing(t, sellerCookie, places, {
    negotiable: overrides.negotiable ?? true,
    price: overrides.price ?? '1000',
  });
  const res = await req('POST', '/api/conversations', buyerCookie, { listingId });
  expect(res.statusCode).toBe(201);
  return { sellerCookie, buyerCookie, listingId, conversationId: res.json().id as string };
}

const send = (cookie: string, conversationId: string, payload: object, key = newKey()) =>
  req('POST', `/api/conversations/${conversationId}/messages`, cookie, payload, key);

async function uploadChatPhoto(cookie: string): Promise<string> {
  const boundary = '----chat';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    await photoBytes(),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/chat-photos',
    headers: {
      ...writeHeaders,
      cookie,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
    remoteAddress: randomIp(),
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

describe('starting a conversation', () => {
  it('returns the same conversation when the buyer opens it again', async () => {
    const { buyerCookie, listingId, conversationId } = await setup();
    const again = await req('POST', '/api/conversations', buyerCookie, { listingId });
    expect(again.json().id).toBe(conversationId);
  });

  it('a seller cannot chat with themselves', async () => {
    const sellerCookie = await seller(t, places);
    const listingId = await publishListing(t, sellerCookie, places);
    const res = await req('POST', '/api/conversations', sellerCookie, { listingId });
    expect(res.statusCode).toBe(403);
  });

  it('only live listings can start a conversation', async () => {
    const sellerCookie = await seller(t, places);
    const listingId = await publishListing(t, sellerCookie, places);
    await req('POST', `/api/listings/${listingId}/actions`, sellerCookie, { action: 'pause' });
    const res = await req('POST', '/api/conversations', await seller(t, places), { listingId });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('listing_unavailable');
  });

  it('the seller only sees the conversation after the buyer writes', async () => {
    const { sellerCookie, buyerCookie, conversationId } = await setup();
    expect((await req('GET', '/api/conversations', sellerCookie)).json()).toEqual([]);
    await send(buyerCookie, conversationId, { type: 'text', text: 'السلام عليكم، لسه موجود؟' });
    const list = (await req('GET', '/api/conversations', sellerCookie)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      role: 'seller',
      counterpart: { displayName: 'Buyer' },
      unread: 1,
    });
  });
});

describe('messages', () => {
  it('masks phone numbers and links before storing, and raises fraud flags', async () => {
    const { buyerCookie, conversationId } = await setup();
    const res = await send(buyerCookie, conversationId, {
      type: 'text',
      text: 'حوّل لي بنكك وكلمني 0912345678 أو wa.me/249912345678',
    });
    expect(res.statusCode).toBe(201);
    const message = res.json();
    expect(message.text).toBe('حوّل لي بنكك وكلمني ••• أو •••');
    expect(message.flags).toEqual(['contact_masked', 'off_platform']);

    const stored = await t.db.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId));
    expect(JSON.stringify(stored.map((m) => m.body))).not.toContain('912345678');
    const flags = await t.db.db
      .select()
      .from(fraudFlags)
      .where(eq(fraudFlags.targetId, message.id));
    expect(flags.map((f) => f.rule).sort()).toEqual(['chat_contact_masked', 'chat_off_platform']);
  });

  it('is retry-safe: the same key sends the message once', async () => {
    const { buyerCookie, conversationId } = await setup();
    const key = newKey();
    const a = await send(buyerCookie, conversationId, { type: 'text', text: 'hi' }, key);
    const b = await send(buyerCookie, conversationId, { type: 'text', text: 'hi' }, key);
    expect(b.json().id).toBe(a.json().id);
    const page = (
      await req('GET', `/api/conversations/${conversationId}/messages`, buyerCookie)
    ).json();
    expect(page.items).toHaveLength(1);
  });

  it('pages through history and catches up after a reconnect', async () => {
    const { buyerCookie, sellerCookie, conversationId } = await setup();
    for (let i = 0; i < 35; i++) {
      await send(i % 2 ? sellerCookie : buyerCookie, conversationId, {
        type: 'text',
        text: `m${i}`,
      });
    }
    const latest = (
      await req('GET', `/api/conversations/${conversationId}/messages`, buyerCookie)
    ).json();
    expect(latest.items).toHaveLength(30);
    expect(latest.hasMore).toBe(true);
    expect(latest.items.at(-1).text).toBe('m34');

    const older = (
      await req(
        'GET',
        `/api/conversations/${conversationId}/messages?before=${latest.items[0].id}`,
        buyerCookie,
      )
    ).json();
    expect(older.items.map((m: { text: string }) => m.text)).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'm4',
    ]);

    const newer = (
      await req(
        'GET',
        `/api/conversations/${conversationId}/messages?after=${latest.items[27].id}`,
        buyerCookie,
      )
    ).json();
    expect(newer.items.map((m: { text: string }) => m.text)).toEqual(['m33', 'm34']);
  });

  it('tracks unread messages per person', async () => {
    const { buyerCookie, sellerCookie, conversationId } = await setup();
    await send(buyerCookie, conversationId, { type: 'text', text: 'one' });
    await send(buyerCookie, conversationId, { type: 'text', text: 'two' });
    const unread = async (cookie: string) =>
      (await req('GET', '/api/conversations/unread', cookie)).json();
    expect(await unread(sellerCookie)).toEqual({ signedIn: true, count: 2 });
    expect(await unread(buyerCookie)).toEqual({ signedIn: true, count: 0 });
    await req('POST', `/api/conversations/${conversationId}/read`, sellerCookie);
    expect(await unread(sellerCookie)).toEqual({ signedIn: true, count: 0 });
    // Visitors get an empty answer rather than an error (the bottom navigation asks on every page).
    expect(await unread('')).toEqual({ signedIn: false, count: 0 });
  });

  it('sends photos that only the two people can see', async () => {
    const { buyerCookie, sellerCookie, conversationId } = await setup();
    const photoId = await uploadChatPhoto(buyerCookie);
    const stranger = await seller(t, places);
    expect((await req('GET', `/api/media/${photoId}`, sellerCookie)).statusCode).toBe(404);

    const res = await send(buyerCookie, conversationId, { type: 'image', photoId });
    expect(res.json()).toMatchObject({ type: 'image', photoId });
    expect((await req('GET', `/api/media/${photoId}?w=320`, sellerCookie)).statusCode).toBe(200);
    expect((await req('GET', `/api/media/${photoId}`, stranger)).statusCode).toBe(404);
    expect((await t.app.inject({ url: `/api/media/${photoId}` })).statusCode).toBe(404);

    // A photo can't be sent twice, and nobody can send someone else's photo.
    expect((await send(buyerCookie, conversationId, { type: 'image', photoId })).statusCode).toBe(
      400,
    );
    const other = await uploadChatPhoto(stranger);
    expect(
      (await send(buyerCookie, conversationId, { type: 'image', photoId: other })).statusCode,
    ).toBe(400);
  });

  it('stops messages once a listing is removed', async () => {
    const { buyerCookie, conversationId, listingId } = await setup();
    await t.db.sql`update listings set status = 'removed' where id = ${listingId}`;
    const res = await send(buyerCookie, conversationId, { type: 'text', text: 'hello?' });
    expect(res.json().error).toBe('listing_unavailable');
  });
});

describe('IDOR: other people’s conversations', () => {
  it('a third person can’t read, write, mark read or act on offers in a conversation', async () => {
    const { buyerCookie, conversationId } = await setup();
    const offer = (
      await send(buyerCookie, conversationId, { type: 'offer', amount: '800' })
    ).json();
    const stranger = await seller(t, places);

    const attempts = [
      await req('GET', `/api/conversations/${conversationId}`, stranger),
      await req('GET', `/api/conversations/${conversationId}/messages`, stranger),
      await send(stranger, conversationId, { type: 'text', text: 'hi' }),
      await req('POST', `/api/conversations/${conversationId}/read`, stranger),
      await req(
        'POST',
        `/api/conversations/${conversationId}/offers/${offer.offer.id}/actions`,
        stranger,
        {
          action: 'accept',
        },
      ),
    ];
    for (const res of attempts) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
    expect((await req('GET', '/api/conversations', stranger)).json()).toEqual([]);
  });

  it('an offer id from another conversation is not found', async () => {
    const a = await setup();
    const b = await setup();
    const offer = (
      await send(a.buyerCookie, a.conversationId, { type: 'offer', amount: '500' })
    ).json();
    const res = await req(
      'POST',
      `/api/conversations/${b.conversationId}/offers/${offer.offer.id}/actions`,
      b.sellerCookie,
      { action: 'accept' },
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('offers', () => {
  const act = (cookie: string, conversationId: string, offerId: string, action: string) =>
    req('POST', `/api/conversations/${conversationId}/offers/${offerId}/actions`, cookie, {
      action,
    });

  it('the buyer offers, the seller accepts', async () => {
    const { buyerCookie, sellerCookie, conversationId } = await setup({ price: '1000' });
    const message = (
      await send(buyerCookie, conversationId, { type: 'offer', amount: '850.50' })
    ).json();
    expect(message.offer).toMatchObject({ amountMinor: '85050', status: 'pending' });

    // A buyer can't accept their own offer.
    expect((await act(buyerCookie, conversationId, message.offer.id, 'accept')).statusCode).toBe(
      403,
    );

    const accepted = await act(sellerCookie, conversationId, message.offer.id, 'accept');
    expect(accepted.json().offer.status).toBe('accepted');
    // Decided offers can't change again.
    expect((await act(sellerCookie, conversationId, message.offer.id, 'decline')).statusCode).toBe(
      409,
    );
  });

  it('allows one open offer at a time; declined or withdrawn offers free the slot', async () => {
    const { buyerCookie, sellerCookie, conversationId } = await setup();
    const first = (
      await send(buyerCookie, conversationId, { type: 'offer', amount: '700' })
    ).json();
    expect(
      (await send(buyerCookie, conversationId, { type: 'offer', amount: '750' })).statusCode,
    ).toBe(409);
    await act(sellerCookie, conversationId, first.offer.id, 'decline');
    const second = (
      await send(buyerCookie, conversationId, { type: 'offer', amount: '750' })
    ).json();
    expect(
      (await act(buyerCookie, conversationId, second.offer.id, 'withdraw')).json().offer.status,
    ).toBe('withdrawn');
    expect(
      (await send(buyerCookie, conversationId, { type: 'offer', amount: '800' })).statusCode,
    ).toBe(201);
  });

  it('refuses offers above the asking price, from the seller, or on non-negotiable listings', async () => {
    const { buyerCookie, sellerCookie, conversationId } = await setup({ price: '1000' });
    const above = await send(buyerCookie, conversationId, { type: 'offer', amount: '1000.01' });
    expect(above.json().fields).toEqual({ amount: 'invalid_price' });
    await send(buyerCookie, conversationId, { type: 'text', text: 'hi' });
    expect(
      (await send(sellerCookie, conversationId, { type: 'offer', amount: '900' })).json().error,
    ).toBe('offer_not_allowed');

    const fixed = await setup({ negotiable: false });
    const res = await send(fixed.buyerCookie, fixed.conversationId, {
      type: 'offer',
      amount: '10',
    });
    expect(res.json().error).toBe('offer_not_allowed');
  });

  it('offers expire after 48 hours and can then be replaced', async () => {
    const { buyerCookie, sellerCookie, conversationId } = await setup();
    const message = (
      await send(buyerCookie, conversationId, { type: 'offer', amount: '600' })
    ).json();
    await t.db.db
      .update(offers)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(offers.id, message.offer.id));

    const page = (
      await req('GET', `/api/conversations/${conversationId}/messages`, buyerCookie)
    ).json();
    expect(page.items[0].offer.status).toBe('expired');
    expect((await act(sellerCookie, conversationId, message.offer.id, 'accept')).statusCode).toBe(
      409,
    );
    const [row] = await t.db.db.select().from(offers).where(eq(offers.id, message.offer.id));
    expect(row!.status).toBe('expired');
    expect(
      (await send(buyerCookie, conversationId, { type: 'offer', amount: '650' })).statusCode,
    ).toBe(201);
  });
});

describe('realtime', () => {
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  });
  afterAll(() => sockets.forEach((s) => s.disconnect()));

  const open = (cookie: string | undefined, origin = APP_ORIGIN) => {
    const socket = connect(url, {
      path: '/api/socket.io',
      transports: ['websocket'],
      extraHeaders: { origin, ...(cookie ? { cookie } : {}) },
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  };

  it('pushes new messages to the other person', async () => {
    const { buyerCookie, sellerCookie, conversationId } = await setup();
    const socket = open(sellerCookie);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
    const received = new Promise<{ text: string }>((resolve) => socket.on('chat:message', resolve));
    await send(buyerCookie, conversationId, { type: 'text', text: 'live!' });
    expect((await received).text).toBe('live!');
  });

  it('closes the connection when the session is logged out', async () => {
    const { sellerCookie } = await setup();
    const socket = open(sellerCookie);
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
    const closed = new Promise<string>((resolve) => socket.on('disconnect', resolve));
    await req('POST', '/api/auth/logout', sellerCookie);
    expect(await closed).toBe('io server disconnect');
  });

  it('refuses connections without a session', async () => {
    const error = await new Promise<Error>((resolve) =>
      open(undefined).on('connect_error', resolve),
    );
    expect(error.message).toBe('unauthenticated');
  });

  it('accepts same-origin long-polling, which browsers send without an Origin header', async () => {
    const { buyerCookie } = await setup();
    // A real request: Socket.IO listens on the HTTP server, which inject() bypasses.
    const handshake = async (headers: Record<string, string>) =>
      (
        await fetch(`${url}/api/socket.io?EIO=4&transport=polling`, {
          headers: { cookie: buyerCookie, ...headers },
        })
      ).status;
    expect(await handshake({ 'sec-fetch-site': 'same-origin' })).toBe(200);
    expect(await handshake({ 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(await handshake({ origin: 'https://evil.example' })).toBe(403);
  });

  it('refuses connections from other websites', async () => {
    const { buyerCookie } = await setup();
    const error = await new Promise<Error>((resolve) =>
      open(buyerCookie, 'https://evil.example').on('connect_error', resolve),
    );
    expect(error).toBeTruthy();
  });
});
