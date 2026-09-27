import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { BASE_URL, randomLocalPhone } from './helpers';

/**
 * Logs in through the API (the same endpoints the login screen uses) and completes the
 * profile, so tests that aren't about login start from a ready seller or buyer.
 */
export async function loginAs(page: Page, displayName: string): Promise<void> {
  const headers = { 'x-souqna-csrf': '1', origin: new URL(BASE_URL).origin };
  const phone = randomLocalPhone();

  const requested = await page.request.post('/api/auth/otp/request', { headers, data: { phone } });
  expect(requested.ok()).toBe(true);
  const { challengeId } = await requested.json();
  const e164 = `+249${phone.slice(1)}`;
  const otp = await page.request.get(`/api/dev/otp?phone=${encodeURIComponent(e164)}`);
  const { code } = await otp.json();
  const verified = await page.request.post('/api/auth/otp/verify', {
    headers,
    data: { challengeId, code },
  });
  expect(verified.ok()).toBe(true);

  const cities = await (await page.request.get('/api/cities')).json();
  const portSudan = cities.find((c: { nameEn: string }) => c.nameEn === 'Port Sudan');
  const patched = await page.request.patch('/api/me', {
    headers,
    data: { displayName, cityId: portSudan.id },
  });
  expect(patched.ok()).toBe(true);
}

/** A test photo: a coloured square with a shape, so screenshots show something real. */
export async function photoFixture(colour: string): Promise<Buffer> {
  const shape = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><circle cx="450" cy="450" r="260" fill="white" fill-opacity="0.8"/></svg>`,
  );
  return sharp({ create: { width: 900, height: 900, channels: 3, background: colour } })
    .composite([{ input: shape }])
    .jpeg()
    .toBuffer();
}

/** Creates and publishes a listing through the API, for tests that start from a live listing. */
export async function createListing(
  page: Page,
  { title, price, negotiable }: { title: string; price: string; negotiable: boolean },
): Promise<string> {
  const headers = { 'x-souqna-csrf': '1', origin: new URL(BASE_URL).origin };
  const upload = await page.request.post('/api/listing-photos', {
    headers,
    multipart: {
      file: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: await photoFixture('#3b6ea8') },
    },
  });
  expect(upload.ok()).toBe(true);
  const { id: photoId } = await upload.json();

  const categories = await (await page.request.get('/api/categories')).json();
  const phones = categories
    .flatMap((c: { children: Array<{ id: string; nameEn: string }> }) => c.children)
    .find((c: { nameEn: string }) => c.nameEn === 'Mobile phones');
  const cities = await (await page.request.get('/api/cities')).json();
  const city = cities.find((c: { nameEn: string }) => c.nameEn === 'Port Sudan');

  const created = await page.request.post('/api/listings', {
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    data: {
      title,
      description: 'نظيف جداً، شغّال بدون أي مشكلة، معاهو الشاحن.',
      categoryId: phones.id,
      condition: 'good',
      price,
      negotiable,
      cityId: city.id,
      photoIds: [photoId],
      publish: true,
    },
  });
  expect(created.status()).toBe(201);
  const listing = await created.json();
  expect(listing.status).toBe('active');
  return listing.id;
}
