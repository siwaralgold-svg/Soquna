import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectNoHorizontalScroll, toArabicDigits, watchCspViolations } from './helpers';
import { createListing, grantFinance, loginAs, staffCode } from './session';

async function snap(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalScroll(page);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

const tag = () =>
  Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 6);

test('buyer pays by Bankak transfer, finance verifies with 2FA, seller sees money held (Arabic, 360px)', async ({
  browser,
}, info) => {
  const title = `بلايستيشن ٤ ${tag()}`;
  const sellerPage = await (await browser.newContext()).newPage();
  await loginAs(sellerPage, 'أم أحمد');
  const listingId = await createListing(sellerPage, { title, price: '200000', negotiable: false });

  // --- Buyer: checkout -----------------------------------------------------------
  const buyerPage = await (await browser.newContext()).newPage();
  const buyerCsp = watchCspViolations(buyerPage);
  await loginAs(buyerPage, 'Sara');
  await buyerPage.goto(`/listings/${listingId}`);
  await buyerPage.getByRole('link', { name: 'اشتري بأمان' }).click();
  await expect(buyerPage.getByRole('heading', { level: 1 })).toHaveText('اشتري بأمان');
  // 200,000 + 5,000 courier + (1,000 + 5 % = 11,000) protection = 216,000 SDG.
  await expect(buyerPage.getByTestId('order-total')).toContainText(toArabicDigits('216'));
  await expect(buyerPage.getByRole('radio', { name: /كاش عند الاستلام/ })).toBeDisabled();
  await expect(buyerPage.getByText('متاح بعد أول طلب مكتمل ليك.')).toBeVisible();
  await buyerPage.getByRole('radio', { name: /مقابلة شخصية/ }).check();
  await expect(buyerPage.getByTestId('order-total')).toContainText(toArabicDigits('211'));
  await buyerPage.getByRole('radio', { name: /مندوب توصيل/ }).check();
  await buyerPage.getByRole('radio', { name: /تحويل بنكك/ }).check();
  await snap(buyerPage, info, '1-checkout');
  await buyerPage.getByRole('button', { name: 'أكّد الطلب' }).click();

  // --- Buyer: order page, pay ------------------------------------------------------
  await expect(buyerPage).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  const orderUrl = new URL(buyerPage.url()).pathname;
  await expect(buyerPage.getByTestId('order-status')).toHaveText('في انتظار الدفع');
  await expect(buyerPage.getByTestId('pay-amount')).toContainText(toArabicDigits('216'));
  const code = (await buyerPage.getByText(/^رقم الطلب SQ-/).textContent())!.replace(
    'رقم الطلب ',
    '',
  );
  await snap(buyerPage, info, '2-awaiting-payment');

  await buyerPage.getByLabel('رقم العملية (من إشعار التحويل)').fill('تم');
  await buyerPage.getByRole('button', { name: 'دفعت، أرسل رقم العملية' }).click();
  await expect(buyerPage.getByText(/اكتب رقم العملية زي ما ظاهر/)).toBeVisible();
  const reference = `FT${Date.now()}`;
  await buyerPage
    .getByLabel('رقم العملية (من إشعار التحويل)')
    .fill(toArabicDigits(reference.slice(2)));
  await buyerPage.getByRole('button', { name: 'دفعت، أرسل رقم العملية' }).click();
  await expect(buyerPage.getByTestId('order-status')).toHaveText('بنراجع الدفع');

  // The listing is now reserved: nobody else can buy it.
  const otherPage = await (await browser.newContext()).newPage();
  await otherPage.goto(`/listings/${listingId}`);
  await expect(otherPage.getByText('محجوز', { exact: true })).toBeVisible();
  await expect(otherPage.getByRole('link', { name: 'اشتري بأمان' })).toHaveCount(0);

  // --- Finance: 2FA, then verify ----------------------------------------------------
  const financePage = await (await browser.newContext()).newPage();
  const financePhone = await loginAs(financePage, 'Finance');
  grantFinance(financePhone);
  await financePage.goto('/admin/payments');
  await expect(financePage.getByRole('heading', { name: 'التحقق بخطوتين' })).toBeVisible();
  await financePage.getByLabel('الرمز').fill(staffCode(financePhone));
  await financePage.getByRole('button', { name: 'تحقّق' }).click();
  const card = financePage.getByRole('listitem').filter({ hasText: code });
  await expect(card).toContainText(reference.slice(2));
  await snap(financePage, info, '3-finance-queue');
  await card.getByRole('button', { name: 'المبلغ وصل، أكّد' }).click();
  await expect(card).toHaveCount(0);

  // --- Buyer sees it live; seller prepares the item ---------------------------------
  await expect(buyerPage.getByTestId('order-status')).toHaveText('اتدفع، القروش محفوظة', {
    timeout: 10_000,
  });
  await sellerPage.goto('/orders?role=selling');
  await sellerPage.getByRole('link', { name: new RegExp(title) }).click();
  await expect(sellerPage).toHaveURL(new RegExp(`${orderUrl}$`));
  await expect(sellerPage.getByText(/القروش محفوظة بأمان عند سوقنا/)).toBeVisible();
  await snap(sellerPage, info, '4-seller-funds-held');
  await sellerPage.getByRole('button', { name: 'الحاجة جاهزة للتسليم' }).click();
  await expect(sellerPage.getByTestId('order-status')).toHaveText('جاهز للتسليم');
  await expect(buyerPage.getByTestId('order-status')).toHaveText('جاهز للتسليم', {
    timeout: 10_000,
  });
  await expect(
    buyerPage.getByRole('listitem').filter({ hasText: 'اتدفع، القروش محفوظة' }),
  ).toContainText('سوقنا');
  await snap(buyerPage, info, '5-buyer-timeline');
  expect(buyerCsp).toEqual([]);
});

test('a test payment, then the buyer cancels and is refunded', async ({ browser }) => {
  const sellerPage = await (await browser.newContext()).newPage();
  await loginAs(sellerPage, 'بائع');
  const listingId = await createListing(sellerPage, {
    title: `كرسي خشب ${tag()}`,
    price: '30000',
    negotiable: false,
  });

  const buyerPage = await (await browser.newContext()).newPage();
  await loginAs(buyerPage, 'مشتري');
  await buyerPage.goto(`/checkout/${listingId}`);
  await buyerPage.getByRole('radio', { name: /مقابلة شخصية/ }).check();
  await buyerPage.getByRole('radio', { name: /دفع تجريبي/ }).check();
  await buyerPage.getByRole('button', { name: 'أكّد الطلب' }).click();
  await buyerPage.getByRole('button', { name: 'ادفع الآن (تجريبي)' }).click();
  await expect(buyerPage.getByTestId('order-status')).toHaveText('اتدفع، القروش محفوظة');

  await buyerPage.getByRole('button', { name: 'ألغِ الطلب' }).click();
  await buyerPage.getByLabel('السبب (اختياري)').fill('غيّرت رأيي');
  await buyerPage.getByRole('button', { name: 'أيوه' }).click();
  await expect(buyerPage.getByTestId('order-status')).toHaveText('اتلغى');
  await expect(buyerPage.getByText(/بنرجّع ليك/)).toBeVisible();
  await expect(buyerPage.getByText('غيّرت رأيي')).toBeVisible();

  // The item is back on sale.
  await buyerPage.goto(`/listings/${listingId}`);
  await expect(buyerPage.getByRole('link', { name: 'اشتري بأمان' })).toBeVisible();
});
