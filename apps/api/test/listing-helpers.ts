import { randomBytes } from 'node:crypto';
import { IDEMPOTENCY_HEADER, type ListingInput } from '@souqna/contracts';
import { categories, cities } from '@souqna/db';
import sharp from 'sharp';
import { login, randomIp, writeHeaders, type TestApp } from './helpers';

export interface Places {
  mobilePhones: string;
  phonesParent: string;
  furniture: string;
  portSudan: string;
  kassala: string;
}

export async function loadPlaces(t: TestApp): Promise<Places> {
  const cats = await t.db.db.select().from(categories);
  const cits = await t.db.db.select().from(cities);
  const cat = (slug: string) => cats.find((c) => c.slug === slug)!.id;
  const city = (slug: string) => cits.find((c) => c.slug === slug)!.id;
  return {
    mobilePhones: cat('mobile-phones'),
    phonesParent: cat('phones-tablets'),
    furniture: cat('furniture'),
    portSudan: city('port-sudan'),
    kassala: city('kassala'),
  };
}

/** Logs in a new user and completes their profile, so they can sell. */
export async function seller(t: TestApp, places: Places, name = 'Seller'): Promise<string> {
  const { cookie } = await login(t);
  await t.app.inject({
    method: 'PATCH',
    url: '/api/me',
    headers: { ...writeHeaders, cookie },
    payload: { displayName: name, cityId: places.portSudan },
  });
  return cookie;
}

export async function photoBytes(): Promise<Buffer> {
  return sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#2a7' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestPhone' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '19/1 36/1 0/1' },
    })
    .toBuffer();
}

export async function uploadPhoto(t: TestApp, cookie: string, data?: Buffer): Promise<string> {
  const boundary = '----souqnaPhoto';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    data ?? (await photoBytes()),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/listing-photos',
    headers: {
      ...writeHeaders,
      cookie,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
    remoteAddress: randomIp(),
  });
  if (res.statusCode !== 201) throw new Error(`photo upload failed: ${res.statusCode} ${res.body}`);
  return res.json().id;
}

export function newKey(): string {
  return randomBytes(16).toString('hex');
}

export function listingBody(places: Places, overrides: Partial<ListingInput> = {}): ListingInput {
  return {
    title: 'Samsung phone',
    description: 'Clean phone, works well, with charger.',
    categoryId: places.mobilePhones,
    condition: 'good',
    price: '150000',
    negotiable: true,
    cityId: places.portSudan,
    photoIds: [],
    publish: true,
    ...overrides,
  };
}

export async function postListing(t: TestApp, cookie: string, body: ListingInput, key = newKey()) {
  return t.app.inject({
    method: 'POST',
    url: '/api/listings',
    headers: { ...writeHeaders, cookie, [IDEMPOTENCY_HEADER]: key },
    payload: body,
    remoteAddress: randomIp(),
  });
}

/** Creates a published listing with one photo and returns its id. */
export async function publishListing(
  t: TestApp,
  cookie: string,
  places: Places,
  overrides: Partial<ListingInput> = {},
): Promise<string> {
  const photo = await uploadPhoto(t, cookie);
  const res = await postListing(
    t,
    cookie,
    listingBody(places, { photoIds: [photo], ...overrides }),
  );
  if (res.statusCode !== 201) throw new Error(`create failed: ${res.statusCode} ${res.body}`);
  return res.json().id;
}

/** A word that only this test uses, so searches don't see other tests' listings. */
export function uniqueWord(): string {
  return `zq${randomBytes(4).toString('hex').replace(/\d/g, 'x')}`;
}
