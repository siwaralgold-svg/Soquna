import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, watchCspViolations } from './helpers';

test('home page is Arabic, right-to-left, and fits a 360px screen', async ({ page }, info) => {
  const violations = watchCspViolations(page);
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('قروشك محفوظة لحدي ما تستلم');
  await expectNoHorizontalScroll(page);

  // In RTL the brand name sits on the right-hand side of the header.
  const brand = await page.getByRole('link', { name: 'سوقنا' }).boundingBox();
  expect(brand!.x).toBeGreaterThan(180);

  await page.screenshot({ path: info.outputPath('home-ar-360.png'), fullPage: true });
  await info.attach('home-ar-360', {
    path: info.outputPath('home-ar-360.png'),
    contentType: 'image/png',
  });
  expect(violations).toEqual([]);
});

test('English lives at /en and is left-to-right', async ({ page }) => {
  await page.goto('/en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Your money is safe until you receive your item',
  );
  await expectNoHorizontalScroll(page);
});

test('language switch keeps you on the same page', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'تغيير اللغة إلى الإنجليزية' }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('pages carry a strict nonce-based CSP and security headers', async ({ page }) => {
  const response = await page.goto('/');
  const headers = response!.headers();
  const csp = headers['content-security-policy']!;
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-inline');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-powered-by']).toBeUndefined();

  // Each request gets a fresh nonce.
  const again = (await page.goto('/'))!.headers()['content-security-policy'];
  expect(again).not.toBe(csp);
});

test('first load stays under the 200 KB JavaScript budget', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  // Sum the compressed (over-the-wire) size of every script the page loaded.
  const bytes = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((e) => (e as PerformanceResourceTiming).initiatorType === 'script')
      .reduce((sum, e) => sum + (e as PerformanceResourceTiming).encodedBodySize, 0),
  );
  console.log(`First-load JS (compressed): ${(bytes / 1024).toFixed(1)} KB`);
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThan(200 * 1024);
});

test('PWA manifest and offline page are available', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ lang: 'ar', dir: 'rtl', display: 'standalone', start_url: '/' });
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);

  const offline = await request.get('/offline.html');
  expect(offline.ok()).toBe(true);
  expect(await offline.text()).toContain('ما في إنترنت');

  await page.goto('/');
  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.scriptURL ?? null;
  });
  expect(registered).toMatch(/\/sw\.js$/);
});

test('unknown pages show a translated 404', async ({ page }) => {
  const res = await page.goto('/no-such-page');
  expect(res!.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الصفحة دي ما موجودة');
});
