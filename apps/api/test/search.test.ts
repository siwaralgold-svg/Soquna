import { auditLog, listingReports } from '@souqna/db';
import { normalizeForSearch } from '@souqna/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { moderateListing } from '../src/modules/listings/moderation';
import { createTestApp, randomIp, writeHeaders, type TestApp } from './helpers';
import { loadPlaces, publishListing, seller, uniqueWord, type Places } from './listing-helpers';

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

const search = async (params: Record<string, string | string[]>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    for (const value of Array.isArray(v) ? v : [v]) qs.append(k, value);
  }
  const res = await get(`/api/listings?${qs}`);
  expect(res.statusCode).toBe(200);
  return res.json();
};

const titles = (page: { items: { title: string }[] }) => page.items.map((i) => i.title);

describe('SQL and TypeScript normalisation agree', () => {
  it.each([
    'الأدوات المنزلية',
    'مُحَمَّدٌ',
    'جمـــيل',
    'iPhone ١٣ Pro Max!',
    'مكتبة مستشفى إبريق آلة ٱلقمر',
    'ال الى على',
    '  كرسي،  طاولة!! ',
    'Café & crème',
  ])('%s', async (text) => {
    const [row] = await t.db.sql`select souqna_normalize(${text}) as n`;
    expect(row!.n).toBe(normalizeForSearch(text));
  });
});

describe('search', () => {
  it('matches Arabic spelling variants, diacritics and the definite article', async () => {
    const cookie = await seller(t, places);
    const word = uniqueWord();
    await publishListing(t, cookie, places, {
      title: `الأدوات المنزلية ${word}`,
      categoryId: places.furniture,
    });
    for (const q of ['ادوات منزليه', 'أَدَوَات', 'الادوات', 'منزلي']) {
      expect(titles(await search({ q: `${q} ${word}` }))).toHaveLength(1);
    }
  });

  it('matches word prefixes and is case-insensitive in English', async () => {
    const cookie = await seller(t, places);
    const word = uniqueWord();
    await publishListing(t, cookie, places, { title: `ايفون 13 iPhone ${word}` });
    expect(titles(await search({ q: `ايف ${word}` }))).toHaveLength(1);
    expect(titles(await search({ q: `IPHO ${word}` }))).toHaveLength(1);
    expect(titles(await search({ q: `samsung ${word}` }))).toHaveLength(0);
  });

  it('finds words in the description too, but ranks title matches first', async () => {
    const cookie = await seller(t, places);
    const word = uniqueWord();
    await publishListing(t, cookie, places, {
      title: 'Plain title here',
      description: `Great condition, the ${word} version.`,
    });
    await publishListing(t, cookie, places, { title: `Title with ${word}` });
    expect(titles(await search({ q: word }))).toEqual([`Title with ${word}`, 'Plain title here']);
  });

  it('treats search text as plain words (no query injection)', async () => {
    const res = await get(`/api/listings?q=${encodeURIComponent("') | !:* & (")}`);
    expect(res.statusCode).toBe(200);
  });

  it('filters by city, category (incl. sub-categories), price range and condition', async () => {
    const cookie = await seller(t, places);
    const word = uniqueWord();
    await publishListing(t, cookie, places, {
      title: `A ${word}`,
      price: '1000',
      condition: 'new',
    });
    await publishListing(t, cookie, places, {
      title: `B ${word}`,
      price: '5000',
      condition: 'fair',
      cityId: places.kassala,
    });
    await publishListing(t, cookie, places, {
      title: `C ${word}`,
      price: '9000',
      categoryId: places.furniture,
    });

    expect(titles(await search({ q: word, city: places.kassala }))).toEqual([`B ${word}`]);
    expect(titles(await search({ q: word, category: places.phonesParent })).sort()).toEqual([
      `A ${word}`,
      `B ${word}`,
    ]);
    expect(titles(await search({ q: word, minPrice: '2000', maxPrice: '9000' })).sort()).toEqual([
      `B ${word}`,
      `C ${word}`,
    ]);
    expect(titles(await search({ q: word, condition: ['new', 'fair'] })).sort()).toEqual([
      `A ${word}`,
      `B ${word}`,
    ]);
  });

  it('sorts by price both ways and by newest', async () => {
    const cookie = await seller(t, places);
    const word = uniqueWord();
    for (const [title, price] of [
      ['mid', '5000'],
      ['low', '100'],
      ['high', '90000'],
    ]) {
      await publishListing(t, cookie, places, { title: `${title} ${word}`, price });
    }
    expect(titles(await search({ q: word, sort: 'price_asc' }))).toEqual([
      `low ${word}`,
      `mid ${word}`,
      `high ${word}`,
    ]);
    expect(titles(await search({ q: word, sort: 'price_desc' }))).toEqual([
      `high ${word}`,
      `mid ${word}`,
      `low ${word}`,
    ]);
    expect(titles(await search({ q: word, sort: 'newest' }))).toEqual([
      `high ${word}`,
      `low ${word}`,
      `mid ${word}`,
    ]);
  });

  it('pages through results', async () => {
    const cookie = await seller(t, places);
    const word = uniqueWord();
    // Brand-new accounts are limited to 5 listings, so use several sellers.
    for (let s = 0; s < 5; s++) {
      const c = s === 0 ? cookie : await seller(t, places);
      for (let i = 0; i < 5; i++)
        await publishListing(t, c, places, { title: `item ${word} ${s}${i}` });
    }
    const first = await search({ q: word });
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    const second = await search({ q: word, page: '1' });
    expect(second.items).toHaveLength(5);
    expect(second.hasMore).toBe(false);
  });

  it('rejects silly page numbers', async () => {
    expect((await get('/api/listings?page=51')).statusCode).toBe(400);
  });

  it('lists categories as a tree', async () => {
    const tree = (await get('/api/categories')).json();
    const phones = tree.find((c: { id: string }) => c.id === places.phonesParent);
    expect(phones.children.map((c: { id: string }) => c.id)).toContain(places.mobilePhones);
  });
});

describe('favourites', () => {
  it('saves and removes favourites, and marks them on the listing', async () => {
    const owner = await seller(t, places);
    const fan = await seller(t, places);
    const id = await publishListing(t, owner, places);
    const fav = (method: 'PUT' | 'DELETE') =>
      t.app.inject({
        method,
        url: `/api/listings/${id}/favourite`,
        headers: { ...writeHeaders, cookie: fan },
      });

    expect((await fav('PUT')).statusCode).toBe(204);
    expect((await fav('PUT')).statusCode).toBe(204);
    expect((await get(`/api/listings/${id}`, fan)).json().isFavourite).toBe(true);
    expect((await get('/api/me/favourites', fan)).json().map((c: { id: string }) => c.id)).toEqual([
      id,
    ]);

    expect((await fav('DELETE')).statusCode).toBe(204);
    expect((await get('/api/me/favourites', fan)).json()).toEqual([]);
  });

  it('cannot favourite a listing that is not public, and hides favourites that become private', async () => {
    const owner = await seller(t, places);
    const fan = await seller(t, places);
    const id = await publishListing(t, owner, places);
    await t.app.inject({
      method: 'PUT',
      url: `/api/listings/${id}/favourite`,
      headers: { ...writeHeaders, cookie: fan },
    });
    await t.app.inject({
      method: 'POST',
      url: `/api/listings/${id}/actions`,
      headers: { ...writeHeaders, cookie: owner },
      payload: { action: 'pause' },
    });
    expect((await get('/api/me/favourites', fan)).json()).toEqual([]);
    const again = await t.app.inject({
      method: 'PUT',
      url: `/api/listings/${id}/favourite`,
      headers: { ...writeHeaders, cookie: fan },
    });
    expect(again.statusCode).toBe(404);
  });
});

describe('reports and moderation', () => {
  const report = (id: string, cookie: string, reason = 'scam') =>
    t.app.inject({
      method: 'POST',
      url: `/api/listings/${id}/report`,
      headers: { ...writeHeaders, cookie },
      payload: { reason },
      remoteAddress: randomIp(),
    });

  it('cannot report your own listing', async () => {
    const owner = await seller(t, places);
    const id = await publishListing(t, owner, places);
    expect((await report(id, owner)).statusCode).toBe(403);
  });

  it('three different reporters hide a listing until a moderator decides', async () => {
    const owner = await seller(t, places);
    const word = uniqueWord();
    const id = await publishListing(t, owner, places, { title: `Reported ${word}` });

    const first = await seller(t, places);
    expect((await report(id, first)).statusCode).toBe(204);
    expect((await report(id, first)).statusCode).toBe(204); // repeat is ignored
    await report(id, await seller(t, places));
    expect((await search({ q: word })).items).toHaveLength(1);
    await report(id, await seller(t, places), 'prohibited');

    expect((await search({ q: word })).items).toHaveLength(0);
    expect((await get(`/api/listings/${id}`, owner)).json().status).toBe('pending_review');
    const actions = (await t.db.db.select().from(auditLog).where(eq(auditLog.targetId, id))).map(
      (a) => a.action,
    );
    expect(actions).toContain('listing.flagged_by_reports');

    await moderateListing(t.db.db, {
      listingId: id,
      action: 'approve',
      moderatorId: null,
      via: 'test',
    });
    expect((await search({ q: word })).items).toHaveLength(1);
    const reports = await t.db.db
      .select()
      .from(listingReports)
      .where(eq(listingReports.listingId, id));
    expect(reports.every((r) => r.status === 'dismissed')).toBe(true);
  });

  it('rejecting needs a reason, which only the seller sees', async () => {
    const owner = await seller(t, places);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/listings',
      headers: { ...writeHeaders, cookie: owner, 'idempotency-key': `k${uniqueWord()}0000000000` },
      payload: {
        title: 'Medicine for sale',
        description: 'Unopened box, expires next year.',
        categoryId: places.furniture,
        condition: 'new',
        price: '500',
        cityId: places.portSudan,
        photoIds: [],
        publish: false,
      },
    });
    const id = res.json().id;
    await t.app.inject({
      method: 'POST',
      url: `/api/listings/${id}/actions`,
      headers: { ...writeHeaders, cookie: owner },
      payload: { action: 'publish' },
    });

    await expect(
      moderateListing(t.db.db, { listingId: id, action: 'reject', moderatorId: null, via: 'test' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    // It's still a draft without photos, so publish failed; flag it directly for this test.
    await t.db.sql`update listings set status = 'pending_review' where id = ${id}`;
    await moderateListing(t.db.db, {
      listingId: id,
      action: 'reject',
      note: 'Medicines are not allowed.',
      moderatorId: null,
      via: 'test',
    });
    const mine = (await get(`/api/listings/${id}`, owner)).json();
    expect(mine).toMatchObject({
      status: 'rejected',
      moderationNote: 'Medicines are not allowed.',
    });
  });

  it('refuses decisions the state machine does not allow', async () => {
    const owner = await seller(t, places);
    const id = await publishListing(t, owner, places);
    await expect(
      moderateListing(t.db.db, {
        listingId: id,
        action: 'approve',
        moderatorId: null,
        via: 'test',
      }),
    ).rejects.toThrow(/cannot approve from active/);
  });
});
