import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fraudFlags, ledgerEntries, orderEvents, orders, userRoles } from '@souqna/db';
import { applyTransition } from '../src/modules/orders/transition';
import { runOrderTimers } from '../src/jobs/timers';
import { personalBalances, platformBalance } from '../src/modules/orders/ledger';
import { enrolTotp } from '../src/modules/staff/mfa';
import { totpCode, totpStep } from '../src/lib/totp';
import { createHmac } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, login, randomIp, writeHeaders, type TestApp } from './helpers';
import {
  loadPlaces,
  newKey,
  photoBytes,
  publishListing,
  seller,
  type Places,
} from './listing-helpers';

const PSP_SECRET = 'test-psp-secret';
let t: TestApp;
let places: Places;

beforeAll(async () => {
  t = await createTestApp({ PAYMENT_MOCK_ENABLED: 'true', PSP_WEBHOOK_SECRET: PSP_SECRET });
  places = await loadPlaces(t);
});
afterAll(async () => {
  await t.close();
});

type Method = 'GET' | 'POST';
const req = (method: Method, url: string, cookie: string, payload?: object, key?: string) =>
  t.app.inject({
    method,
    url,
    headers: {
      ...(method === 'POST' ? writeHeaders : {}),
      cookie,
      ...(method === 'POST' ? { 'idempotency-key': key ?? newKey() } : {}),
    },
    payload,
    remoteAddress: randomIp(),
  });

const SDG = 100n;
/** Seeded config: protection = 1,000 SDG + 5 %, capped at 25,000; courier 5,000 SDG. */
const totalFor = (price: bigint, delivery: 'courier' | 'meetup') =>
  price + (delivery === 'courier' ? 5_000n * SDG : 0n) + 1_000n * SDG + (price * 500n) / 10_000n;

async function people() {
  return {
    sellerCookie: await seller(t, places, 'Seller'),
    buyerCookie: await seller(t, places, 'Buyer'),
  };
}

async function buy(
  opts: {
    payment?: 'bank_transfer' | 'mock' | 'cod';
    delivery?: 'courier' | 'meetup';
    price?: string;
  } = {},
) {
  const { sellerCookie, buyerCookie } = await people();
  const listingId = await publishListing(t, sellerCookie, places, { price: opts.price ?? '20000' });
  const res = await req('POST', '/api/orders', buyerCookie, {
    listingId,
    paymentMethod: opts.payment ?? 'bank_transfer',
    deliveryMethod: opts.delivery ?? 'courier',
  });
  expect(res.statusCode, res.body).toBe(201);
  return { sellerCookie, buyerCookie, listingId, orderId: res.json().id as string };
}

const detail = async (cookie: string, orderId: string) =>
  (await req('GET', `/api/orders/${orderId}`, cookie)).json();

const listingStatus = async (listingId: string) =>
  (await t.app.inject({ method: 'GET', url: `/api/listings/${listingId}` })).json().status;

let refCounter = 0;
const newRef = () => `FT${Date.now()}${(refCounter++).toString().padStart(4, '0')}`;

const pay = (cookie: string, orderId: string, reference = newRef()) =>
  req('POST', `/api/orders/${orderId}/payments`, cookie, { reference });

/** A finance person who has entered their 2FA code on this session. */
async function financeCookie(): Promise<string> {
  const { cookie } = await login(t);
  const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
  const userId = me.json().id as string;
  await t.db.db.insert(userRoles).values({ userId, role: 'finance' });
  const secret = await enrolTotp(t.app.ctx, userId);
  // The code for the next step, so it's never the one another test just used.
  const code = totpCode(secret, totpStep(Date.now()) + 1);
  const res = await req('POST', '/api/staff/mfa', cookie, { code });
  expect(res.statusCode, res.body).toBe(204);
  return cookie;
}

async function latestPaymentId(orderId: string, finance: string): Promise<string> {
  const list = (await req('GET', '/api/staff/payments', finance)).json();
  return list.find((p: { order: { id: string } }) => p.order.id === orderId).id;
}

describe('checkout', () => {
  it('quotes item + delivery + buyer protection', async () => {
    const { sellerCookie, buyerCookie } = await people();
    const listingId = await publishListing(t, sellerCookie, places, { price: '200000' });
    const quote = (
      await req(
        'GET',
        `/api/checkout/quote?listingId=${listingId}&deliveryMethod=courier`,
        buyerCookie,
      )
    ).json();
    expect(quote).toMatchObject({
      itemMinor: '20000000',
      deliveryMinor: '500000',
      protectionMinor: '1100000',
      totalMinor: '21600000',
      paymentHours: 24,
      inspectionHours: 48,
    });
    // Cash on delivery needs a completed order first.
    expect(quote.paymentMethods).toEqual([
      { method: 'bank_transfer', refusal: null },
      { method: 'cod', refusal: 'cod_needs_history' },
      { method: 'mock', refusal: null },
    ]);
    const meetup = (
      await req(
        'GET',
        `/api/checkout/quote?listingId=${listingId}&deliveryMethod=meetup`,
        buyerCookie,
      )
    ).json();
    expect(meetup.deliveryMinor).toBe('0');
    // Sellers can't buy their own item.
    expect(
      (await req('GET', `/api/checkout/quote?listingId=${listingId}`, sellerCookie)).statusCode,
    ).toBe(403);
  });

  it('creates an order waiting for payment and reserves the listing', async () => {
    const { buyerCookie, sellerCookie, listingId, orderId } = await buy();
    const order = await detail(buyerCookie, orderId);
    expect(order).toMatchObject({
      status: 'awaiting_payment',
      role: 'buyer',
      canPay: true,
      actions: ['cancel'],
      needsAction: true,
      amounts: { totalMinor: totalFor(20_000n * SDG, 'courier').toString() },
    });
    expect(order.code).toMatch(/^SQ-[2-9A-HJ-NP-Z]{6}$/);
    expect(order.payment.instructions).toMatchObject({
      bankName: 'Bankak (Bank of Khartoum)',
      amountMinor: order.amounts.totalMinor,
      note: order.code,
    });
    expect(order.timeline.map((e: { status: string; by: string }) => [e.status, e.by])).toEqual([
      ['created', 'you'],
      ['awaiting_payment', 'souqna'],
    ]);
    expect(await listingStatus(listingId)).toBe('reserved');

    // The seller sees it, without payment details.
    const sellerView = await detail(sellerCookie, orderId);
    expect(sellerView).toMatchObject({ role: 'seller', canPay: false, actions: [] });
    expect(sellerView.payment.instructions).toBeNull();
    const selling = (await req('GET', '/api/orders?role=selling', sellerCookie)).json();
    expect(selling.map((o: { id: string }) => o.id)).toContain(orderId);
  });

  it('never sells the same item twice', async () => {
    const { listingId } = await buy();
    const other = await seller(t, places, 'Late buyer');
    const res = await req('POST', '/api/orders', other, {
      listingId,
      paymentMethod: 'bank_transfer',
      deliveryMethod: 'courier',
    });
    expect(res.json().error).toBe('listing_unavailable');
  });

  it('is idempotent: a retried checkout returns the same order', async () => {
    const { sellerCookie, buyerCookie } = await people();
    const listingId = await publishListing(t, sellerCookie, places);
    const key = newKey();
    const body = { listingId, paymentMethod: 'bank_transfer', deliveryMethod: 'meetup' };
    const first = await req('POST', '/api/orders', buyerCookie, body, key);
    const again = await req('POST', '/api/orders', buyerCookie, body, key);
    expect(again.json().id).toBe(first.json().id);
    expect(again.headers['idempotent-replayed']).toBe('true');
  });

  it('buys at a price the seller accepted in chat', async () => {
    const { sellerCookie, buyerCookie } = await people();
    const listingId = await publishListing(t, sellerCookie, places, {
      price: '20000',
      negotiable: true,
    });
    const conv = (await req('POST', '/api/conversations', buyerCookie, { listingId })).json().id;
    const offer = (
      await req('POST', `/api/conversations/${conv}/messages`, buyerCookie, {
        type: 'offer',
        amount: '15000',
      })
    ).json().offer;

    // Not accepted yet.
    const early = await req('POST', '/api/orders', buyerCookie, {
      listingId,
      offerId: offer.id,
      paymentMethod: 'bank_transfer',
      deliveryMethod: 'meetup',
    });
    expect(early.json().error).toBe('offer_not_allowed');

    await req('POST', `/api/conversations/${conv}/offers/${offer.id}/actions`, sellerCookie, {
      action: 'accept',
    });
    const res = await req('POST', '/api/orders', buyerCookie, {
      listingId,
      offerId: offer.id,
      paymentMethod: 'bank_transfer',
      deliveryMethod: 'meetup',
    });
    expect(res.statusCode).toBe(201);
    expect((await detail(buyerCookie, res.json().id)).amounts.itemMinor).toBe('1500000');
  });

  it('applies the anti-fraud rules', async () => {
    const { sellerCookie, buyerCookie } = await people();
    const listingId = await publishListing(t, sellerCookie, places);
    const cod = await req('POST', '/api/orders', buyerCookie, {
      listingId,
      paymentMethod: 'cod',
      deliveryMethod: 'courier',
    });
    expect(cod.statusCode).toBe(422);
    expect(cod.json()).toMatchObject({
      error: 'order_not_allowed',
      fields: { paymentMethod: 'cod_needs_history' },
    });

    // A brand-new account can't spend above the cap (500,000 SDG).
    const pricey = await publishListing(t, sellerCookie, places, { price: '600000' });
    const big = await req('POST', '/api/orders', buyerCookie, {
      listingId: pricey,
      paymentMethod: 'bank_transfer',
      deliveryMethod: 'meetup',
    });
    expect(big.json().fields).toEqual({ paymentMethod: 'new_account_limit' });
  });

  it('limits how many unpaid orders a buyer can open', async () => {
    const buyerCookie = await seller(t, places, 'Hoarder');
    const sellerCookie = await seller(t, places, 'Seller');
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      const listingId = await publishListing(t, sellerCookie, places);
      results.push(
        (
          await req('POST', '/api/orders', buyerCookie, {
            listingId,
            paymentMethod: 'bank_transfer',
            deliveryMethod: 'meetup',
          })
        ).statusCode,
      );
    }
    expect(results).toEqual([201, 201, 201, 429]);
  });
});

describe('who can see and change an order (no IDOR)', () => {
  it('hides the order from everyone but its buyer and seller', async () => {
    const { orderId, sellerCookie } = await buy();
    const stranger = await seller(t, places, 'Stranger');
    expect((await req('GET', `/api/orders/${orderId}`, stranger)).statusCode).toBe(404);
    expect(
      (await req('POST', `/api/orders/${orderId}/actions`, stranger, { action: 'cancel' }))
        .statusCode,
    ).toBe(404);
    expect((await pay(stranger, orderId)).statusCode).toBe(404);
    // The seller can't pay, or cancel an unpaid order for the buyer.
    expect((await pay(sellerCookie, orderId)).statusCode).toBe(403);
    expect(
      (await req('POST', `/api/orders/${orderId}/actions`, sellerCookie, { action: 'cancel' }))
        .statusCode,
    ).toBe(403);
  });

  it('keeps finance screens away from ordinary users and staff without 2FA', async () => {
    const user = await seller(t, places, 'Curious');
    expect((await req('GET', '/api/staff/payments', user)).statusCode).toBe(404);
    expect((await req('GET', '/api/staff/me', user)).statusCode).toBe(404);

    const { cookie } = await login(t);
    const userId = (
      await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    ).json().id;
    await t.db.db.insert(userRoles).values({ userId, role: 'finance' });
    expect((await req('GET', '/api/staff/payments', cookie)).json().error).toBe('mfa_required');
    expect((await req('GET', '/api/staff/me', cookie)).json()).toEqual({
      roles: ['finance'],
      mfaEnrolled: false,
      mfaVerified: false,
    });
    // A moderator is staff, but not finance.
    const mod = await login(t);
    const modId = (
      await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: mod.cookie } })
    ).json().id;
    await t.db.db.insert(userRoles).values({ userId: modId, role: 'moderator' });
    expect((await req('GET', '/api/staff/payments', mod.cookie)).statusCode).toBe(404);
  });

  it('accepts each 2FA code once, and refuses wrong ones', async () => {
    const { cookie } = await login(t);
    const userId = (
      await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    ).json().id;
    await t.db.db.insert(userRoles).values({ userId, role: 'admin' });
    const secret = await enrolTotp(t.app.ctx, userId);
    const code = totpCode(secret, totpStep(Date.now()));
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await req('POST', '/api/staff/mfa', cookie, { code: wrong })).json().error).toBe(
      'otp_invalid',
    );
    expect((await req('POST', '/api/staff/mfa', cookie, { code })).statusCode).toBe(204);
    expect((await req('POST', '/api/staff/mfa', cookie, { code })).json().error).toBe(
      'otp_invalid',
    );
    expect((await req('GET', '/api/staff/me', cookie)).json().mfaVerified).toBe(true);
  });
});

describe('paying by bank transfer', () => {
  it('goes from reference → finance check → money held, and posts the ledger', async () => {
    const { buyerCookie, sellerCookie, orderId } = await buy();
    const finance = await financeCookie();
    const bankBefore = await platformBalance(t.db.db, 'platform_bank');

    const bad = await pay(buyerCookie, orderId, 'paid!');
    expect(bad.json()).toMatchObject({
      error: 'validation_failed',
      fields: { reference: 'invalid_reference' },
    });

    const submitted = await pay(buyerCookie, orderId, 'ft-2409 ٥٥٥ 1234');
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json()).toMatchObject({
      status: 'payment_submitted',
      canPay: false,
      payment: { latest: { status: 'submitted', reference: expect.stringMatching(/^FT2409555/) } },
    });

    const queue = (await req('GET', '/api/staff/payments', finance)).json();
    const item = queue.find((p: { order: { id: string } }) => p.order.id === orderId);
    expect(item).toMatchObject({
      status: 'submitted',
      method: 'bank_transfer',
      buyer: { displayName: 'Buyer' },
    });
    expect(item.amountMinor).toBe(item.order.totalMinor);

    const verify = await req('POST', `/api/staff/payments/${item.id}/verify`, finance);
    expect(verify.statusCode, verify.body).toBe(204);
    const order = await detail(sellerCookie, orderId);
    expect(order.status).toBe('funds_held');
    expect(order.actions).toEqual(['mark_ready', 'cancel']);
    expect(order.deadlines.handoverDueAt).not.toBeNull();

    const total = BigInt(order.amounts.totalMinor);
    expect((await platformBalance(t.db.db, 'platform_bank')) - bankBefore).toBe(total);
    // Verifying twice changes nothing.
    expect((await req('POST', `/api/staff/payments/${item.id}/verify`, finance)).statusCode).toBe(
      409,
    );
  });

  it('refuses a transfer reference that was already used', async () => {
    const first = await buy();
    const second = await buy();
    const reference = newRef();
    expect((await pay(first.buyerCookie, first.orderId, reference)).statusCode).toBe(200);
    const dup = await pay(second.buyerCookie, second.orderId, reference.toLowerCase());
    expect(dup.json().error).toBe('payment_reference_used');
    expect((await detail(second.buyerCookie, second.orderId)).status).toBe('awaiting_payment');
    const flags = await t.db.db
      .select()
      .from(fraudFlags)
      .where(eq(fraudFlags.targetId, second.orderId));
    expect(flags.map((f) => f.rule)).toEqual(['duplicate_payment_reference']);
  });

  it('lets the buyer try again after a rejection, a limited number of times', async () => {
    const { buyerCookie, orderId } = await buy();
    const finance = await financeCookie();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect((await pay(buyerCookie, orderId)).statusCode).toBe(200);
      const paymentId = await latestPaymentId(orderId, finance);
      const reject = await req('POST', `/api/staff/payments/${paymentId}/reject`, finance, {
        reason: 'No transfer with this reference',
      });
      expect(reject.statusCode).toBe(204);
    }
    const order = await detail(buyerCookie, orderId);
    expect(order.status).toBe('payment_rejected');
    expect(order.payment).toMatchObject({
      latest: { status: 'rejected', rejectionReason: 'No transfer with this reference' },
      submissionsLeft: 0,
    });
    expect(order.timeline.at(-1)).toMatchObject({ status: 'payment_rejected', by: 'souqna' });
    const fourth = await pay(buyerCookie, orderId);
    expect(fourth.json().fields).toEqual({ reference: 'too_many_attempts' });
  });

  it('keeps the transfer screenshot private to the buyer and finance', async () => {
    const { buyerCookie, orderId } = await buy();
    const boundary = '----proof';
    const upload = await t.app.inject({
      method: 'POST',
      url: '/api/payment-proofs',
      headers: {
        ...writeHeaders,
        cookie: buyerCookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="s.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
        await photoBytes(),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
      remoteAddress: randomIp(),
    });
    const proofId = upload.json().id;
    const res = await req('POST', `/api/orders/${orderId}/payments`, buyerCookie, {
      reference: newRef(),
      proofId,
    });
    expect(res.statusCode).toBe(200);

    const get = (cookie: string) =>
      t.app.inject({ method: 'GET', url: `/api/media/${proofId}?w=320`, headers: { cookie } });
    expect((await get(buyerCookie)).statusCode).toBe(200);
    expect((await get(await seller(t, places, 'Seller peek'))).statusCode).toBe(404);
    expect((await get(await financeCookie())).statusCode).toBe(200);
  });
});

describe('after payment', () => {
  it('a test payment is confirmed at once', async () => {
    const { buyerCookie, orderId } = await buy({ payment: 'mock' });
    const res = await req('POST', `/api/orders/${orderId}/payments`, buyerCookie, {});
    expect(res.json().status).toBe('funds_held');
    expect(res.json().timeline.map((e: { status: string }) => e.status)).toEqual([
      'created',
      'awaiting_payment',
      'payment_submitted',
      'funds_held',
    ]);
  });

  it('seller prepares the item; a cancellation refunds the buyer and frees the listing', async () => {
    const { buyerCookie, sellerCookie, listingId, orderId } = await buy({ payment: 'mock' });
    await req('POST', `/api/orders/${orderId}/payments`, buyerCookie, {});
    const ready = await req('POST', `/api/orders/${orderId}/actions`, sellerCookie, {
      action: 'mark_ready',
    });
    expect(ready.json().status).toBe('ready_for_pickup');

    const cancel = await req('POST', `/api/orders/${orderId}/actions`, buyerCookie, {
      action: 'cancel',
      reason: 'Changed my mind',
    });
    const order = cancel.json();
    expect(order.status).toBe('cancelled');
    expect(order.refundMinor).toBe(order.amounts.totalMinor);
    expect(await listingStatus(listingId)).toBe('active');
    // A retried button press with the same key doesn't do it twice.
    const buyerId = (
      await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: buyerCookie } })
    ).json().id;
    expect((await personalBalances(t.db.db, buyerId)).refundsMinor).toBe(
      BigInt(order.amounts.totalMinor),
    );
  });

  it('unmasks phone numbers in chat once the money is held', async () => {
    const { buyerCookie, listingId, orderId } = await buy({ payment: 'mock' });
    const conv = (await req('POST', '/api/conversations', buyerCookie, { listingId })).json().id;
    const before = await req('POST', `/api/conversations/${conv}/messages`, buyerCookie, {
      type: 'text',
      text: 'رقمي 0912345678',
    });
    expect(before.json().text).toBe('رقمي •••');
    await req('POST', `/api/orders/${orderId}/payments`, buyerCookie, {});
    const after = await req('POST', `/api/conversations/${conv}/messages`, buyerCookie, {
      type: 'text',
      text: 'رقمي 0912345678',
    });
    expect(after.json().text).toBe('رقمي 0912345678');
  });
});

describe('timers', () => {
  const later = (hours: number) => new Date(Date.now() + hours * 3_600_000);

  it('cancels unpaid orders after the payment deadline and frees the listing', async () => {
    const { buyerCookie, listingId, orderId } = await buy();
    await runOrderTimers(t.app.ctx, undefined, later(23));
    expect((await detail(buyerCookie, orderId)).status).toBe('awaiting_payment');
    await runOrderTimers(t.app.ctx, undefined, later(25));
    const order = await detail(buyerCookie, orderId);
    expect(order.status).toBe('cancelled');
    expect(order.timeline.at(-1)).toMatchObject({ by: 'souqna', reason: 'deadline' });
    expect(await listingStatus(listingId)).toBe('active');
  });

  it('expires a paid order the seller never handed over, with a full refund', async () => {
    const { buyerCookie, listingId, orderId } = await buy({ payment: 'mock' });
    await req('POST', `/api/orders/${orderId}/payments`, buyerCookie, {});
    await runOrderTimers(t.app.ctx, undefined, later(73));
    const order = await detail(buyerCookie, orderId);
    expect(order.status).toBe('expired');
    expect(order.refundMinor).toBe(order.amounts.totalMinor);
    // The seller didn't show up, so the listing is paused rather than relisted.
    expect(
      (await t.app.inject({ method: 'GET', url: `/api/listings/${listingId}` })).statusCode,
    ).toBe(404);
  });

  it('completes after the inspection window and releases a new seller’s money after the hold', async () => {
    const { buyerCookie, sellerCookie, listingId, orderId } = await buy({
      payment: 'mock',
      delivery: 'meetup',
    });
    await req('POST', `/api/orders/${orderId}/payments`, buyerCookie, {});
    await req('POST', `/api/orders/${orderId}/actions`, sellerCookie, { action: 'mark_ready' });
    // The meetup hand-over (with the buyer's code) arrives in Phase 5; drive it directly.
    const [row] = await t.db.db.select().from(orders).where(eq(orders.id, orderId));
    await t.db.db.transaction((tx) =>
      applyTransition(tx, {
        orderId,
        event: 'hand_over',
        actor: { type: 'seller', id: row!.sellerId },
      }),
    );
    expect((await detail(buyerCookie, orderId)).actions).toEqual(['confirm_received']);

    // Inspection window: 48 h.
    const first = await runOrderTimers(t.app.ctx, undefined, later(49));
    expect(first).toBeGreaterThanOrEqual(1);
    let order = await detail(sellerCookie, orderId);
    expect(order.status).toBe('completed');
    expect(await listingStatus(listingId)).toBe('sold');
    const item = BigInt(order.amounts.itemMinor);
    expect(await personalBalances(t.db.db, row!.sellerId)).toMatchObject({
      pendingMinor: item,
      availableMinor: 0n,
    });

    // New seller: 7-day hold. Running the timers again (or twice) is harmless.
    await runOrderTimers(t.app.ctx, undefined, later(50));
    expect((await detail(sellerCookie, orderId)).status).toBe('completed');
    const holdEnds = new Date(new Date(order.deadlines.payoutHoldUntil).getTime() + 60_000);
    await Promise.all([
      runOrderTimers(t.app.ctx, undefined, holdEnds),
      runOrderTimers(t.app.ctx, undefined, holdEnds),
    ]);
    order = await detail(sellerCookie, orderId);
    expect(order.status).toBe('payout_released');
    expect(await personalBalances(t.db.db, row!.sellerId)).toMatchObject({
      pendingMinor: 0n,
      availableMinor: item,
    });
    const balance = (await req('GET', '/api/me/balance', sellerCookie)).json();
    expect(balance).toEqual({
      pendingMinor: '0',
      availableMinor: item.toString(),
      refundsMinor: '0',
    });
  });

  it('lets the buyer confirm before the window ends', async () => {
    const { buyerCookie, sellerCookie, orderId } = await buy({
      payment: 'mock',
      delivery: 'meetup',
    });
    await req('POST', `/api/orders/${orderId}/payments`, buyerCookie, {});
    await req('POST', `/api/orders/${orderId}/actions`, sellerCookie, { action: 'mark_ready' });
    const [row] = await t.db.db.select().from(orders).where(eq(orders.id, orderId));
    await t.db.db.transaction((tx) =>
      applyTransition(tx, {
        orderId,
        event: 'hand_over',
        actor: { type: 'seller', id: row!.sellerId },
      }),
    );
    // The seller can't confirm for the buyer.
    expect(
      (
        await req('POST', `/api/orders/${orderId}/actions`, sellerCookie, {
          action: 'confirm_received',
        })
      ).statusCode,
    ).toBe(403);
    const done = await req('POST', `/api/orders/${orderId}/actions`, buyerCookie, {
      action: 'confirm_received',
    });
    expect(done.json().status).toBe('completed');
  });
});

describe('ledger integrity', () => {
  it('every transaction sums to zero, and escrow never goes positive', async () => {
    const unbalanced = await t.db.db.execute(
      sql`select transaction_id from ${ledgerEntries} group by transaction_id having sum(amount_minor) <> 0 or count(*) < 2`,
    );
    expect(unbalanced).toHaveLength(0);
    expect(await platformBalance(t.db.db, 'escrow_held')).toBeLessThanOrEqual(0n);
  });

  it('the database refuses unbalanced or edited money records', async () => {
    const [entry] = await t.db.db.select().from(ledgerEntries).limit(1);
    await expect(
      t.db.db.update(ledgerEntries).set({ amountMinor: 1n }).where(eq(ledgerEntries.id, entry!.id)),
    ).rejects.toThrow();
    const [event] = await t.db.db.select().from(orderEvents).limit(1);
    await expect(
      t.db.db.delete(orderEvents).where(eq(orderEvents.id, event!.id)),
    ).rejects.toThrow();
    await expect(
      t.db.db.transaction(async (tx) => {
        const [tr] = await tx.execute<{ id: string }>(
          sql`insert into ledger_transactions (kind, idempotency_key) values ('test', ${newKey()}) returning id`,
        );
        await tx
          .insert(ledgerEntries)
          .values({ transactionId: tr!.id, accountId: entry!.accountId, amountMinor: 5n });
      }),
    ).rejects.toThrow(/unbalanced/);
  });

  it('only transition() changes an order’s status', () => {
    const root = join(__dirname, '../src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts') && !path.endsWith(join('orders', 'transition.ts'))) {
          if (/\.update\(orders\)/.test(readFileSync(path, 'utf8'))) offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('payment gateway webhook (stub)', () => {
  const sign = (body: string, ts: number) =>
    `sha256=${createHmac('sha256', PSP_SECRET).update(`${ts}.${body}`).digest('hex')}`;
  const post = (body: string, headers: Record<string, string>) =>
    t.app.inject({
      method: 'POST',
      url: '/api/payments/psp/webhook',
      headers: { 'content-type': 'application/json', ...headers },
      payload: body,
    });

  it('accepts a correctly signed, recent event without cookies or CSRF header', async () => {
    const body = JSON.stringify({ type: 'payment.succeeded', orderCode: 'SQ-TEST22' });
    const ts = Math.floor(Date.now() / 1000);
    const res = await post(body, {
      'x-psp-timestamp': String(ts),
      'x-psp-signature': sign(body, ts),
    });
    expect(res.statusCode).toBe(202);
  });

  it('refuses a bad signature, a tampered body, or an old timestamp', async () => {
    const body = JSON.stringify({ type: 'payment.succeeded' });
    const ts = Math.floor(Date.now() / 1000);
    expect(
      (await post(body, { 'x-psp-timestamp': String(ts), 'x-psp-signature': 'sha256=00' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await post(`${body} `, { 'x-psp-timestamp': String(ts), 'x-psp-signature': sign(body, ts) }))
        .statusCode,
    ).toBe(403);
    const old = ts - 3600;
    expect(
      (await post(body, { 'x-psp-timestamp': String(old), 'x-psp-signature': sign(body, old) }))
        .statusCode,
    ).toBe(403);
    expect((await post(body, {})).statusCode).toBe(403);
  });
});
