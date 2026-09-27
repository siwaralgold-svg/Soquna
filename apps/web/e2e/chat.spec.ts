import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectNoHorizontalScroll, toArabicDigits, watchCspViolations } from './helpers';
import { createListing, loginAs } from './session';

async function snap(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalScroll(page);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

/** A random tag so titles are unique (digits would look like a phone number and be refused). */
const tag = () =>
  Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 6);

async function send(page: Page, text: string) {
  await page.getByLabel('الرسالة').fill(text);
  await page.getByRole('button', { name: 'أرسل', exact: true }).click();
}

test('buyer and seller chat, phone numbers are hidden, and an offer is accepted (Arabic, 360px)', async ({
  browser,
}, info) => {
  const title = `آيفون للبيع ${tag()}`;

  const sellerContext = await browser.newContext();
  const sellerPage = await sellerContext.newPage();
  const sellerCsp = watchCspViolations(sellerPage);
  await loginAs(sellerPage, 'أم أحمد');
  const listingId = await createListing(sellerPage, { title, price: '200000', negotiable: true });

  // --- Buyer opens a chat from the listing ---------------------------------
  const buyerContext = await browser.newContext();
  const buyerPage = await buyerContext.newPage();
  const buyerCsp = watchCspViolations(buyerPage);
  await loginAs(buyerPage, 'Sara');
  await buyerPage.goto(`/listings/${listingId}`);
  await buyerPage.getByRole('button', { name: 'كلّم البائع' }).click();
  await expect(buyerPage).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
  await expect(buyerPage.getByRole('heading', { level: 1 })).toHaveText('أم أحمد');
  await expect(buyerPage.getByRole('heading', { name: 'عشان تكون في أمان' })).toBeVisible();
  await snap(buyerPage, info, '1-chat-empty');

  await send(buyerPage, 'السلام عليكم، الموبايل لسه موجود؟');
  await expect(buyerPage.getByTestId('message')).toHaveCount(1);

  // Typing a phone number shows a hint, and the number is hidden once sent.
  await buyerPage.getByLabel('الرسالة').fill(`كلمني على ${toArabicDigits('0912345678')}`);
  await expect(
    buyerPage.getByText('أرقام التلفون والروابط بتتخفى لحدي ما تعمل طلب.'),
  ).toBeVisible();
  await buyerPage.getByRole('button', { name: 'أرسل', exact: true }).click();
  await expect(buyerPage.getByTestId('message')).toHaveCount(2);
  await expect(buyerPage.getByText('كلمني على •••')).toBeVisible();
  await expect(buyerPage.getByText(/خفينا رقم تلفون أو رابط/)).toBeVisible();
  await expect(buyerPage.getByTestId('outgoing')).toHaveCount(0);

  // --- Seller sees an unread badge and the masked message ------------------
  await sellerPage.goto('/');
  await expect(sellerPage.getByTestId('unread-badge')).toContainText(/^[2٢]/);
  await sellerPage.getByRole('link', { name: /المحادثات/ }).click();
  await expect(sellerPage.getByRole('heading', { level: 1 })).toHaveText('المحادثات');
  await expect(sellerPage.getByText(title)).toBeVisible();
  await snap(sellerPage, info, '2-chats-list');
  await sellerPage.getByRole('link', { name: /Sara/ }).click();
  await expect(sellerPage.getByText('كلمني على •••')).toBeVisible();
  await expect(sellerPage.getByText(/0912345678|٠٩١٢٣٤٥٦٧٨/)).toHaveCount(0);

  // Live delivery: the buyer's open screen gets the reply without reloading.
  await send(sellerPage, 'أيوه موجود. لو عايزة تشتري ادفعي عن طريق سوقنا.');
  await expect(buyerPage.getByText('أيوه موجود. لو عايزة تشتري ادفعي عن طريق سوقنا.')).toBeVisible({
    timeout: 10_000,
  });

  // A seller who suggests paying outside the app gets flagged in context.
  await send(sellerPage, 'أو حوّل لي بنكك أسهل');
  await expect(buyerPage.getByText(/الدفع عن طريق سوقنا بس هو المحمي/)).toBeVisible({
    timeout: 10_000,
  });

  // --- Buyer makes an offer; the seller accepts it --------------------------
  await buyerPage.getByRole('button', { name: 'قدّم عرض' }).click();
  await buyerPage.getByLabel('عرضك (بالجنيه)').fill(toArabicDigits('250000'));
  await buyerPage.getByRole('button', { name: 'أرسل العرض' }).click();
  await expect(buyerPage.getByText('العرض لازم ما يزيد عن السعر المطلوب.')).toBeVisible();
  await buyerPage.getByLabel('عرضك (بالجنيه)').fill(toArabicDigits('180000'));
  await buyerPage.getByRole('button', { name: 'أرسل العرض' }).click();
  const buyerOffer = buyerPage.getByTestId('offer');
  await expect(buyerOffer).toContainText('في الانتظار');
  // Only one offer can wait at a time.
  await expect(buyerPage.getByRole('button', { name: 'قدّم عرض' })).toHaveCount(0);

  const sellerOffer = sellerPage.getByTestId('offer');
  await expect(sellerOffer).toContainText('في الانتظار', { timeout: 10_000 });
  await snap(sellerPage, info, '3-offer-received');
  await sellerOffer.getByRole('button', { name: 'اقبل' }).click();
  await expect(sellerOffer).toContainText('اتقبل');
  await expect(buyerOffer).toContainText('اتقبل', { timeout: 10_000 });
  await expect(buyerOffer).toContainText('البائع قبل العرض');
  await snap(buyerPage, info, '4-offer-accepted');

  // --- Sending with no signal: the message waits and goes out by itself ----
  await buyerContext.setOffline(true);
  await send(buyerPage, 'حأجي أستلمه بكرة إن شاء الله');
  await expect(buyerPage.getByTestId('outgoing')).toContainText('مستني الشبكة');
  await snap(buyerPage, info, '5-waiting-offline');
  await buyerContext.setOffline(false);
  await expect(buyerPage.getByTestId('outgoing')).toHaveCount(0, { timeout: 20_000 });
  await expect(sellerPage.getByText('حأجي أستلمه بكرة إن شاء الله')).toBeVisible({
    timeout: 20_000,
  });

  expect(sellerCsp).toEqual([]);
  expect(buyerCsp).toEqual([]);
});

test('a stranger cannot open someone else’s chat', async ({ browser }) => {
  const seller = await (await browser.newContext()).newPage();
  await loginAs(seller, 'بائع');
  const listingId = await createListing(seller, {
    title: `شاشة سامسونج ${tag()}`,
    price: '90000',
    negotiable: false,
  });

  const buyer = await (await browser.newContext()).newPage();
  await loginAs(buyer, 'مشتري');
  await buyer.goto(`/listings/${listingId}`);
  // Not negotiable: no offer button.
  await expect(buyer.getByRole('button', { name: 'قدّم عرض' })).toHaveCount(0);
  await buyer.getByRole('button', { name: 'كلّم البائع' }).click();
  await expect(buyer).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
  const chatUrl = new URL(buyer.url()).pathname;

  const stranger = await (await browser.newContext()).newPage();
  await loginAs(stranger, 'غريب');
  await stranger.goto(chatUrl);
  await expect(stranger.getByText('ما لقينا الحاجة المطلوبة.')).toBeVisible();
  await expect(stranger.getByLabel('الرسالة')).toHaveCount(0);
});
