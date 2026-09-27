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
