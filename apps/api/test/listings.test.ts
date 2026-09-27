import { IDEMPOTENCY_HEADER } from '@souqna/contracts';
import { auditLog, listings, media } from '@souqna/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, randomIp, writeHeaders, type TestApp, createTestApp } from './helpers';
import {
  listingBody,
  loadPlaces,
  newKey,
  postListing,
  publishListing,
  seller,
  uniqueWord,
  uploadPhoto,
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

const get = (url: string, cookie?: string) =>
  t.app.inject({ url, headers: cookie ? { cookie } : {}, remoteAddress: randomIp() });

const put = (url: string, cookie: string, payload?: object) =>
  t.app.inject({
    method: 'PUT',
    url,
    headers: { ...writeHeaders, cookie },
    payload,
    remoteAddress: randomIp(),
  });

const post = (url: string, cookie: string, payload?: object) =>
  t.app.inject({
    method: 'POST',
    url,
    headers: { ...writeHeaders, cookie },
    payload,
    remoteAddress: randomIp(),
  });

describe('listing photos', () => {
  it('stores three WebP sizes without EXIF/GPS, visible only to the owner until published', async () => {
    const owner = await seller(t, places);
    const other = await seller(t, places);
    const id = await uploadPhoto(t, owner);

    const [row] = await t.db.db.select().from(media).where(eq(media.id, id));
    expect(row!.sizes).toEqual([320, 800, 1280]);

    for (const w of [320, 800, 1280]) {
      const res = await get(`/api/media/${id}?w=${w}`, owner);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      const meta = await sharp(res.rawPayload).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(w);
      expect(meta.exif).toBeUndefined();
    }

    expect((await get(`/api/media/${id}`, other)).statusCode).toBe(404);
    expect((await get(`/api/media/${id}`)).statusCode).toBe(404);
    expect((await get(`/api/media/${id}?w=999`, owner)).statusCode).toBe(400);
  });

  it('never enlarges small photos', async () => {
    const owner = await seller(t, places);
    const small = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    const id = await uploadPhoto(t, owner, small);
    const res = await get(`/api/media/${id}?w=1280`, owner);
    expect((await sharp(res.rawPayload).metadata()).width).toBe(200);
  });
});

describe('creating listings', () => {
  it('publishes a listing that anyone can see, with the exact price', async () => {
    const cookie = await seller(t, places, 'أم أحمد');
    const photo = await uploadPhoto(t, cookie);
    const res = await postListing(
      t,
      cookie,
      listingBody(places, { price: '1,250,000.50', photoIds: [photo] }),
    );
    expect(res.statusCode).toBe(201);
    const listing = res.json();
    expect(listing).toMatchObject({
      status: 'active',
      priceMinor: '125000050',
      isOwner: true,
      seller: { displayName: 'أم أحمد' },
      photos: [{ id: photo }],
      category: { parent: { id: places.phonesParent } },
    });

    const publicView = await get(`/api/listings/${listing.id}`);
    expect(publicView.statusCode).toBe(200);
    expect(publicView.json()).toMatchObject({ isOwner: false, moderationNote: null });

    // Photos of a public listing are public (with short caching).
    const photoRes = await get(`/api/media/${photo}`);
    expect(photoRes.statusCode).toBe(200);
    expect(photoRes.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('never exposes the seller’s phone number', async () => {
    const { cookie, phone } = await login(t);
    await t.app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: { ...writeHeaders, cookie },
      payload: { displayName: 'Ali', cityId: places.portSudan },
    });
    const id = await publishListing(t, cookie, places);
    const body = (await get(`/api/listings/${id}`)).body;
    expect(body).not.toContain(phone.slice(1));
  });

  it('keeps drafts private to the seller', async () => {
    const cookie = await seller(t, places);
    const photo = await uploadPhoto(t, cookie);
    const word = uniqueWord();
    const res = await postListing(
      t,
      cookie,
      listingBody(places, { title: `Draft ${word}`, photoIds: [photo], publish: false }),
    );
    expect(res.json().status).toBe('draft');
    const id = res.json().id;

    expect((await get(`/api/listings/${id}`, cookie)).statusCode).toBe(200);
    expect((await get(`/api/listings/${id}`)).statusCode).toBe(404);
    expect((await get(`/api/listings/${id}`, await seller(t, places))).statusCode).toBe(404);
    expect((await get(`/api/media/${photo}`)).statusCode).toBe(404);
    expect((await get(`/api/listings?q=${word}`)).json().items).toHaveLength(0);
  });

  it('requires a photo to publish, but not to save a draft', async () => {
    const cookie = await seller(t, places);
    const res = await postListing(t, cookie, listingBody(places));
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ photoIds: 'photo_required' });
    expect((await postListing(t, cookie, listingBody(places, { publish: false }))).statusCode).toBe(
      201,
    );
  });

  it('requires a completed profile', async () => {
    const { cookie } = await login(t);
    const res = await postListing(t, cookie, listingBody(places, { publish: false }));
    expect(res.statusCode).toBe(403);
  });

  it.each([
    [{ description: 'Call me on 0912345678 for details' }, 'description', 'contains_contact'],
    [{ title: 'see www.shop.sd' }, 'title', 'contains_contact'],
    [{ price: '0' }, 'price', 'invalid_price'],
    [{ price: '12.345' }, 'price', 'invalid_price'],
    [{ title: 'ab' }, 'title', 'too_short'],
  ])('rejects invalid input %j', async (overrides, field, code) => {
    const cookie = await seller(t, places);
    const res = await postListing(t, cookie, listingBody(places, { ...overrides, publish: false }));
    expect(res.statusCode).toBe(400);
    expect(res.json().fields[field]).toBe(code);
  });

  it('accepts only leaf categories and neighbourhoods of the chosen city', async () => {
    const cookie = await seller(t, places);
    const parent = await postListing(
      t,
      cookie,
      listingBody(places, { categoryId: places.phonesParent, publish: false }),
    );
    expect(parent.json().fields).toEqual({ categoryId: 'not_found' });
    const badCity = await postListing(
      t,
      cookie,
      listingBody(places, { cityId: crypto.randomUUID(), publish: false }),
    );
    expect(badCity.json().fields).toEqual({ cityId: 'not_found' });
  });

  it('blocks prohibited items and creates nothing', async () => {
    const cookie = await seller(t, places);
    const photo = await uploadPhoto(t, cookie);
    const res = await postListing(
      t,
      cookie,
      listingBody(places, { title: 'مسدس للبيع', photoIds: [photo] }),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'listing_prohibited' });
    expect((await get('/api/me/listings', cookie)).json()).toHaveLength(0);
  });

  it('sends review-keyword listings to moderation and logs why', async () => {
    const cookie = await seller(t, places);
    const photo = await uploadPhoto(t, cookie);
    const res = await postListing(
      t,
      cookie,
      listingBody(places, { title: 'أدوية ضغط جديدة', photoIds: [photo] }),
    );
    expect(res.json().status).toBe('pending_review');
    const id = res.json().id;
    expect((await get(`/api/listings/${id}`)).statusCode).toBe(404);

    const [entry] = await t.db.db.select().from(auditLog).where(eq(auditLog.targetId, id));
    expect(entry).toMatchObject({
      action: 'listing.flagged_by_keywords',
      metadata: { matched: ['أدوية'] },
    });
  });

  it('limits brand-new accounts to 5 open listings', async () => {
    const cookie = await seller(t, places);
    for (let i = 0; i < 5; i++) {
      expect(
        (await postListing(t, cookie, listingBody(places, { publish: false }))).statusCode,
      ).toBe(201);
    }
    const res = await postListing(t, cookie, listingBody(places, { publish: false }));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('listing_limit_reached');
  });
});

describe('idempotency', () => {
  it('returns the same listing when a create is retried with the same key', async () => {
    const cookie = await seller(t, places);
    const key = newKey();
    const body = listingBody(places, { publish: false });
    const first = await postListing(t, cookie, body, key);
    const retry = await postListing(t, cookie, body, key);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json().id).toBe(first.json().id);
    expect((await get('/api/me/listings', cookie)).json()).toHaveLength(1);
  });

  it('refuses the same key with a different body', async () => {
    const cookie = await seller(t, places);
    const key = newKey();
    await postListing(t, cookie, listingBody(places, { publish: false }), key);
    const res = await postListing(
      t,
      cookie,
      listingBody(places, { publish: false, price: '999' }),
      key,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('idempotency_conflict');
  });

  it('keys are per user: another user with the same key gets their own result', async () => {
    const a = await seller(t, places);
    const b = await seller(t, places);
    const key = newKey();
    const body = listingBody(places, { publish: false });
    const ra = await postListing(t, a, body, key);
    const rb = await postListing(t, b, body, key);
    expect(rb.statusCode).toBe(201);
    expect(rb.json().id).not.toBe(ra.json().id);
  });

  it('requires the header', async () => {
    const cookie = await seller(t, places);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/listings',
      headers: { ...writeHeaders, cookie },
      payload: listingBody(places, { publish: false }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ [IDEMPOTENCY_HEADER]: 'required' });
  });
});

describe('IDOR: other people’s listings and photos', () => {
  it('cannot edit, pause or delete someone else’s listing', async () => {
    const owner = await seller(t, places);
    const attacker = await seller(t, places);
    const id = await publishListing(t, owner, places);
    const detail = (await get(`/api/listings/${id}`, owner)).json();

    const edit = await put(`/api/listings/${id}`, attacker, {
      ...listingBody(places, {
        title: 'Hacked',
        photoIds: detail.photos.map((p: { id: string }) => p.id),
      }),
      version: detail.version,
    });
    expect(edit.statusCode).toBe(404);
    for (const action of ['pause', 'delete']) {
      expect((await post(`/api/listings/${id}/actions`, attacker, { action })).statusCode).toBe(
        404,
      );
    }
    expect((await get(`/api/listings/${id}`)).json()).toMatchObject({
      title: 'Samsung phone',
      status: 'active',
    });
  });

  it('cannot use someone else’s photo', async () => {
    const owner = await seller(t, places);
    const attacker = await seller(t, places);
    const photo = await uploadPhoto(t, owner);
    const res = await postListing(t, attacker, listingBody(places, { photoIds: [photo] }));
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ photoIds: 'not_found' });
  });

  it('cannot reuse a photo already attached to another listing', async () => {
    const owner = await seller(t, places);
    const photo = await uploadPhoto(t, owner);
    await postListing(t, owner, listingBody(places, { photoIds: [photo] }));
    const res = await postListing(t, owner, listingBody(places, { photoIds: [photo] }));
    expect(res.json().fields).toEqual({ photoIds: 'not_found' });
  });

  it('shows a seller only their own listings', async () => {
    const a = await seller(t, places);
    const b = await seller(t, places);
    await publishListing(t, a, places);
    expect((await get('/api/me/listings', b)).json()).toEqual([]);
  });
});

describe('editing and status changes', () => {
  it('uses the version number to reject edits of an out-of-date copy', async () => {
    const cookie = await seller(t, places);
    const id = await publishListing(t, cookie, places);
    const detail = (await get(`/api/listings/${id}`, cookie)).json();
    const photoIds = detail.photos.map((p: { id: string }) => p.id);

    const first = await put(`/api/listings/${id}`, cookie, {
      ...listingBody(places, { title: 'Updated title', photoIds }),
      version: detail.version,
    });
    expect(first.json()).toMatchObject({ title: 'Updated title', version: detail.version + 1 });

    const stale = await put(`/api/listings/${id}`, cookie, {
      ...listingBody(places, { title: 'Stale edit', photoIds }),
      version: detail.version,
    });
    expect(stale.statusCode).toBe(409);
  });

  it('re-screens edits: adding a review keyword to a live listing sends it to review', async () => {
    const cookie = await seller(t, places);
    const id = await publishListing(t, cookie, places);
    const detail = (await get(`/api/listings/${id}`, cookie)).json();
    const res = await put(`/api/listings/${id}`, cookie, {
      ...listingBody(places, {
        description: 'Comes with free medicine box',
        photoIds: detail.photos.map((p: { id: string }) => p.id),
      }),
      version: detail.version,
    });
    expect(res.json().status).toBe('pending_review');
  });

  it('deletes photos removed during an edit', async () => {
    const cookie = await seller(t, places);
    const keep = await uploadPhoto(t, cookie);
    const drop = await uploadPhoto(t, cookie);
    const created = (
      await postListing(t, cookie, listingBody(places, { photoIds: [keep, drop] }))
    ).json();
    const before = t.storage.objects.size;

    const res = await put(`/api/listings/${created.id}`, cookie, {
      ...listingBody(places, { photoIds: [keep] }),
      version: created.version,
    });
    expect(res.json().photos).toEqual([{ id: keep }]);
    expect((await get(`/api/media/${drop}`, cookie)).statusCode).toBe(404);
    expect(t.storage.objects.size).toBe(before - 3);
  });

  it('pauses, resumes and deletes through the state machine', async () => {
    const cookie = await seller(t, places);
    const word = uniqueWord();
    const id = await publishListing(t, cookie, places, { title: `Chair ${word}` });
    const search = async () => (await get(`/api/listings?q=${word}`)).json().items.length;

    expect((await post(`/api/listings/${id}/actions`, cookie, { action: 'pause' })).json()).toEqual(
      { status: 'paused' },
    );
    expect(await search()).toBe(0);
    expect((await get(`/api/listings/${id}`)).statusCode).toBe(404);

    expect(
      (await post(`/api/listings/${id}/actions`, cookie, { action: 'resume' })).json(),
    ).toEqual({ status: 'active' });
    expect(await search()).toBe(1);

    // Illegal move: a live listing can't be "published" again.
    expect(
      (await post(`/api/listings/${id}/actions`, cookie, { action: 'publish' })).statusCode,
    ).toBe(409);

    expect(
      (await post(`/api/listings/${id}/actions`, cookie, { action: 'delete' })).json(),
    ).toEqual({ status: 'deleted' });
    expect((await get(`/api/listings/${id}`, cookie)).statusCode).toBe(404);
    expect((await get('/api/me/listings', cookie)).json()).toEqual([]);
  });

  it('publishes a draft only when it has a photo', async () => {
    const cookie = await seller(t, places);
    const draft = (await postListing(t, cookie, listingBody(places, { publish: false }))).json();
    const res = await post(`/api/listings/${draft.id}/actions`, cookie, { action: 'publish' });
    expect(res.statusCode).toBe(400);
  });

  it('cannot edit a listing that is reserved by an order', async () => {
    const cookie = await seller(t, places);
    const id = await publishListing(t, cookie, places);
    await t.db.db.update(listings).set({ status: 'reserved' }).where(eq(listings.id, id));
    const detail = (await get(`/api/listings/${id}`, cookie)).json();
    const res = await put(`/api/listings/${id}`, cookie, {
      ...listingBody(places, { photoIds: detail.photos.map((p: { id: string }) => p.id) }),
      version: detail.version,
    });
    expect(res.statusCode).toBe(409);
  });
});
