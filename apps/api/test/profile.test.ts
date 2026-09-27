import { cities, media, neighbourhoods, users } from '@souqna/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, login, toE164, writeHeaders, type TestApp } from './helpers';

let t: TestApp;
let portSudan: string;
let kassala: string;
let kassalaNeighbourhood: string;

beforeAll(async () => {
  t = await createTestApp();
  const rows = await t.db.db.select().from(cities);
  portSudan = rows.find((c) => c.slug === 'port-sudan')!.id;
  kassala = rows.find((c) => c.slug === 'kassala')!.id;
  const [n] = await t.db.db
    .insert(neighbourhoods)
    .values({ cityId: kassala, slug: 'test-hay', nameAr: 'حي تجريبي', nameEn: 'Test' })
    .returning();
  kassalaNeighbourhood = n!.id;
});
afterAll(async () => {
  await t.close();
});

const patchMe = (cookie: string, payload: object) =>
  t.app.inject({ method: 'PATCH', url: '/api/me', headers: { ...writeHeaders, cookie }, payload });

function multipart(filename: string, contentType: string, data: Buffer) {
  const boundary = '----souqnaTestBoundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const uploadAvatar = (cookie: string, filename: string, contentType: string, data: Buffer) => {
  const body = multipart(filename, contentType, data);
  return t.app.inject({
    method: 'POST',
    url: '/api/me/avatar',
    headers: { ...writeHeaders, ...body.headers, cookie },
    payload: body.payload,
  });
};

/** A JPEG with EXIF metadata including GPS coordinates (like a phone photo taken at home). */
async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 600, height: 400, channels: 3, background: '#c33' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'X1' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '19/1 36/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '37/1 13/1 0/1',
      },
    })
    .toBuffer();
}

describe('profile', () => {
  it('returns my own phone number to me, and nobody else’s', async () => {
    const a = await login(t);
    const res = await t.app.inject({ url: '/api/me', headers: { cookie: a.cookie } });
    expect(res.json().phone).toBe(toE164(a.phone));
  });

  it('stores the phone number encrypted', async () => {
    const a = await login(t);
    const id = (await t.app.inject({ url: '/api/me', headers: { cookie: a.cookie } })).json().id;
    const [row] = await t.db.db.select().from(users).where(eq(users.id, id));
    expect(row!.phoneEnc.toString('latin1')).not.toContain(a.phone.slice(1));
  });

  it('completes the profile with a display name and city', async () => {
    const a = await login(t);
    const res = await patchMe(a.cookie, { displayName: '  أم   أحمد ', cityId: portSudan });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      displayName: 'أم أحمد',
      city: { id: portSudan, nameAr: 'بورتسودان' },
      profileComplete: true,
    });
  });

  it('rejects a phone number in the display name', async () => {
    const a = await login(t);
    const res = await patchMe(a.cookie, { displayName: 'Ali 0912345678' });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ displayName: 'display_name_contains_contact' });
  });

  it('rejects unknown fields (no mass assignment)', async () => {
    const a = await login(t);
    const res = await patchMe(a.cookie, { displayName: 'Ali', trustLevel: 'trusted' });
    expect(res.statusCode).toBe(400);
    const me = await t.app.inject({ url: '/api/me', headers: { cookie: a.cookie } });
    expect(me.json().trustLevel).toBe('phone_verified');
  });

  it('rejects an unknown city', async () => {
    const a = await login(t);
    const res = await patchMe(a.cookie, { cityId: crypto.randomUUID() });
    expect(res.json().fields).toEqual({ cityId: 'not_found' });
  });

  it('accepts a neighbourhood only if it belongs to the chosen city', async () => {
    const a = await login(t);
    const wrong = await patchMe(a.cookie, {
      cityId: portSudan,
      neighbourhoodId: kassalaNeighbourhood,
    });
    expect(wrong.statusCode).toBe(400);
    const right = await patchMe(a.cookie, {
      cityId: kassala,
      neighbourhoodId: kassalaNeighbourhood,
    });
    expect(right.json().neighbourhood.id).toBe(kassalaNeighbourhood);
  });

  it('clears the neighbourhood when the city changes', async () => {
    const a = await login(t);
    await patchMe(a.cookie, { cityId: kassala, neighbourhoodId: kassalaNeighbourhood });
    const res = await patchMe(a.cookie, { cityId: portSudan });
    expect(res.json().neighbourhood).toBeNull();
  });

  it('only ever updates the caller’s own profile', async () => {
    const victim = await login(t);
    const attacker = await login(t);
    await patchMe(victim.cookie, { displayName: 'Victim' });
    await patchMe(attacker.cookie, { displayName: 'Attacker' });
    const res = await t.app.inject({ url: '/api/me', headers: { cookie: victim.cookie } });
    expect(res.json().displayName).toBe('Victim');
  });
});

describe('cities', () => {
  it('lists active cities with Arabic and English names, without login', async () => {
    const res = await t.app.inject({ url: '/api/cities' });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list[0]).toMatchObject({ nameAr: 'بورتسودان', nameEn: 'Port Sudan' });
    expect(list.find((c: { id: string }) => c.id === kassala).neighbourhoods).toHaveLength(1);
  });
});

describe('avatar upload', () => {
  it('re-encodes to a 256px WebP and strips EXIF/GPS metadata', async () => {
    const a = await login(t);
    const original = await jpegWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const res = await uploadAvatar(a.cookie, 'me.jpg', 'image/jpeg', original);
    expect(res.statusCode).toBe(200);
    const avatarUrl: string = res.json().avatarUrl;
    expect(avatarUrl).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);

    const image = await t.app.inject({ url: avatarUrl });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/webp');
    const meta = await sharp(image.rawPayload).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(image.rawPayload.includes(Buffer.from('TestPhone'))).toBe(false);
  });

  it('detects the real file type instead of trusting the name or content type', async () => {
    const a = await login(t);
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await uploadAvatar(a.cookie, 'photo.jpg', 'image/jpeg', html);
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe('upload_invalid');
  });

  it('rejects image formats we do not accept (e.g. SVG)', async () => {
    const a = await login(t);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    );
    const res = await uploadAvatar(a.cookie, 'a.png', 'image/png', svg);
    expect(res.json().error).toBe('upload_invalid');
  });

  it('rejects files over 5 MB', async () => {
    const a = await login(t);
    const res = await uploadAvatar(
      a.cookie,
      'big.jpg',
      'image/jpeg',
      Buffer.alloc(5 * 1024 * 1024 + 10, 1),
    );
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('upload_too_large');
  });

  it('removes the old avatar when a new one is uploaded', async () => {
    const a = await login(t);
    const first = (await uploadAvatar(a.cookie, 'a.jpg', 'image/jpeg', await jpegWithGps())).json()
      .avatarUrl;
    const second = (await uploadAvatar(a.cookie, 'b.jpg', 'image/jpeg', await jpegWithGps())).json()
      .avatarUrl;
    expect(second).not.toBe(first);
    expect((await t.app.inject({ url: first })).statusCode).toBe(404);
    expect(t.storage.objects.size).toBeGreaterThan(0);
  });

  it('requires login', async () => {
    const res = await uploadAvatar('', 'a.jpg', 'image/jpeg', await jpegWithGps());
    expect(res.statusCode).toBe(401);
  });

  it('does not serve deleted media', async () => {
    const a = await login(t);
    const id = (await t.app.inject({ url: '/api/me', headers: { cookie: a.cookie } })).json().id;
    const [row] = await t.db.db
      .insert(media)
      .values({
        ownerId: id,
        kind: 'avatar',
        storageKey: `test/${crypto.randomUUID()}`,
        mime: 'image/webp',
        bytes: 1,
        width: 1,
        height: 1,
        sha256: Buffer.alloc(32),
        status: 'deleted',
      })
      .returning();
    expect((await t.app.inject({ url: `/api/media/${row!.id}` })).statusCode).toBe(404);
  });
});
