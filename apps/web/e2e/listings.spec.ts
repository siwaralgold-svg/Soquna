import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectNoHorizontalScroll, toArabicDigits, watchCspViolations } from './helpers';
import { loginAs, photoFixture } from './session';

async function snap(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalScroll(page);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

const word = () =>
  `zq${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 6)}`;

async function fillListing(page: Page, title: string, price = '150000') {
  await page.getByLabel('العنوان').fill(title);
  await page.getByLabel('القسم').selectOption({ label: 'موبايلات' });
  await page.getByRole('radio', { name: 'كويس' }).check();
  await page.getByLabel('السعر', { exact: true }).fill(toArabicDigits(price));
  await page.getByLabel('الوصف').fill('نظيف جداً، شغّال بدون أي مشكلة، معاهو الشاحن.');
}

async function addPhotos(page: Page, count: number) {
  const colours = ['#1f9d74', '#d98a1c', '#3b6ea8'];
  const files = await Promise.all(
    Array.from({ length: count }, async (_, i) => ({
      name: `photo-${i}.jpg`,
      mimeType: 'image/jpeg',
      buffer: await photoFixture(colours[i % colours.length]!),
    })),
  );
  const before = await page.getByRole('button', { name: 'شيل الصورة' }).count();
  await page.locator('#photos').setInputFiles(files);
  await expect(page.getByRole('button', { name: 'شيل الصورة' })).toHaveCount(before + count);
  await expect(page.getByText('جاري الرفع…')).toHaveCount(0, { timeout: 15_000 });
}

test('seller posts a listing and a buyer finds, saves and reports it (Arabic, 360px)', async ({
  browser,
}, info) => {
  const title = `موبايل سامسونج A52 ${word()}`;

  // --- Seller -------------------------------------------------------------
  const sellerPage = await (await browser.newContext()).newPage();
  const violations = watchCspViolations(sellerPage);
  await loginAs(sellerPage, 'أم أحمد');
  await sellerPage.goto('/sell');
  await expect(sellerPage.getByRole('heading', { level: 1 })).toHaveText('بيع حاجة');

  // Phone numbers in the description are refused (anti-fraud).
  await fillListing(sellerPage, title);
  await sellerPage.getByLabel('الوصف').fill('للتواصل 0912345678');
  await addPhotos(sellerPage, 2);
  await snap(sellerPage, info, '1-sell-form');
  await sellerPage.getByRole('button', { name: 'انشر الإعلان' }).click();
  await expect(
    sellerPage.getByText('ما تكتب رقم تلفون أو رابط. التواصل بيكون جوّه سوقنا.'),
  ).toBeVisible();

  await sellerPage.getByLabel('الوصف').fill('نظيف جداً، شغّال بدون أي مشكلة، معاهو الشاحن.');
  await sellerPage.getByRole('button', { name: 'انشر الإعلان' }).click();
  await expect(sellerPage).toHaveURL(/\/listings\/[0-9a-f-]{36}$/);
  await expect(sellerPage.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(sellerPage.getByText('الإعلان منشور وبيظهر للناس.')).toBeVisible();
  await expect(sellerPage.getByRole('img', { name: 'صورة 1 من 2' })).toBeVisible();
  const listingUrl = sellerPage.url();
  await snap(sellerPage, info, '2-listing-owner');
  expect(violations).toEqual([]);

  // --- Buyer --------------------------------------------------------------
  const buyerPage = await (await browser.newContext()).newPage();
  await loginAs(buyerPage, 'Sara');
  await buyerPage.goto('/');
  await expect(buyerPage.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await snap(buyerPage, info, '3-home');

  // Search with a spelling variant and without the model number.
  const unique = title.split(' ').at(-1)!;
  await buyerPage.getByRole('searchbox').fill(`سامسونج ${unique}`);
  await buyerPage.getByRole('button', { name: 'بحث' }).click();
  await expect(buyerPage).toHaveURL(/\/search\?q=/);
  await expect(buyerPage.getByText('نتائج «')).toBeVisible();
  await snap(buyerPage, info, '4-search');
  await buyerPage.getByRole('link', { name: new RegExp(title) }).click();

  await expect(buyerPage).toHaveURL(listingUrl);
  await expect(buyerPage.getByText('قابل للتفاوض', { exact: true })).toHaveCount(0);
  await expect(buyerPage.getByText('نصايح للأمان')).toBeVisible();
  await expect(buyerPage.getByText('أم أحمد')).toBeVisible();
  await snap(buyerPage, info, '5-listing-buyer');

  await buyerPage.getByRole('button', { name: 'احفظ في المفضلة' }).click();
  await expect(buyerPage.getByRole('button', { name: 'شيل من المفضلة' })).toBeVisible();

  await buyerPage.getByText('بلّغ عن الإعلان', { exact: true }).click();
  await buyerPage.getByRole('radio', { name: 'قسم غلط' }).check();
  await buyerPage.getByRole('button', { name: 'أرسل البلاغ' }).click();
  await expect(buyerPage.getByText('شكراً. بنراجع الإعلان.')).toBeVisible();

  await buyerPage.goto('/favourites');
  await expect(buyerPage.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await snap(buyerPage, info, '6-favourites');

  // --- Seller manages the listing -----------------------------------------
  await sellerPage.goto('/my/listings');
  await expect(sellerPage.getByText('منشور')).toBeVisible();
  await sellerPage.getByRole('button', { name: 'إيقاف مؤقت' }).click();
  await expect(sellerPage.getByText('موقوف مؤقتاً')).toBeVisible();
  await snap(sellerPage, info, '7-my-listings');

  // Paused listings disappear for everyone else.
  const hidden = await buyerPage.goto(listingUrl);
  expect(hidden!.status()).toBe(404);
});

test('prohibited items are refused with a link to the policy', async ({ page }) => {
  await loginAs(page, 'Ali');
  await page.goto('/sell');
  await fillListing(page, `مسدس للبيع ${word()}`);
  await addPhotos(page, 1);
  await page.getByRole('button', { name: 'انشر الإعلان' }).click();
  await expect(
    page.getByText('الإعلان فيه حاجة ممنوعة في سوقنا. راجع قائمة الممنوعات.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'قائمة الممنوعات' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الحاجات الممنوعة في سوقنا');
});

test('the sell form survives a reload and a lost connection (offline draft)', async ({
  page,
  context,
}, info) => {
  await loginAs(page, 'Draft tester');
  await page.goto('/sell');
  const title = `كرسي خشب ${word()}`;
  await page.getByLabel('العنوان').fill(title);
  await page.waitForTimeout(700); // the draft is saved shortly after typing stops

  await page.reload();
  await expect(page.getByText('رجّعنا المسودة اللي كنت شغّال فيها.')).toBeVisible();
  await expect(page.getByLabel('العنوان')).toHaveValue(title);

  // Take a photo with no signal: it waits, then uploads when the connection returns.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText('ما في إنترنت. شغلك محفوظ في موبايلك')).toBeVisible();
  await page.locator('#photos').setInputFiles({
    name: 'p.jpg',
    mimeType: 'image/jpeg',
    buffer: await photoFixture('#3b6ea8'),
  });
  await expect(page.getByText('في انتظار الشبكة…')).toBeVisible();
  await snap(page, info, 'offline-draft');

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('في انتظار الشبكة…')).toHaveCount(0, { timeout: 15_000 });

  await page.getByRole('button', { name: 'ابدأ من جديد' }).click();
  await expect(page.getByLabel('العنوان')).toHaveValue('');
});

test('search filters and sorting work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/search?sort=price_asc');
  await expect(page.getByRole('heading', { name: 'بحث' })).toBeAttached();
  await page.getByText('تصفية وترتيب').click();
  await page.getByLabel('الترتيب').selectOption({ label: 'السعر: من الأعلى' });
  await page.getByRole('button', { name: 'تطبيق' }).click();
  await expect(page).toHaveURL(/sort=price_desc/);
  await expectNoHorizontalScroll(page);
});
