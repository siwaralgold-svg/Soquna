import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  randomLocalPhone,
  toArabicDigits,
  watchCspViolations,
} from './helpers';

async function snap(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalScroll(page);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function readOtp(page: Page, phone: string): Promise<string> {
  const e164 = `+249${phone.slice(1)}`;
  const res = await page.request.get(`/api/dev/otp?phone=${encodeURIComponent(e164)}`);
  expect(res.ok()).toBe(true);
  return (await res.json()).code;
}

test('new user logs in with phone + OTP, completes profile, and manages devices (Arabic, 360px)', async ({
  page,
}, info) => {
  const violations = watchCspViolations(page);
  const phone = randomLocalPhone();

  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تسجيل الدخول');
  await snap(page, info, '1-login-phone');

  // Invalid number is caught in the browser, with an Arabic message.
  await page.getByLabel('رقم الموبايل').fill('12345');
  await page.getByRole('button', { name: 'أرسل الرمز' }).click();
  await expect(page.getByText('الرقم ده ما رقم موبايل سوداني صحيح.')).toBeVisible();

  // Many Arabic keyboards type Arabic-Indic digits.
  await page.getByLabel('رقم الموبايل').fill(toArabicDigits(phone));
  await page.getByRole('button', { name: 'أرسل الرمز' }).click();
  await expect(page.getByRole('heading', { name: 'أدخل الرمز' })).toBeVisible();
  await expect(page.getByText(phone.slice(-3))).toBeVisible();
  await snap(page, info, '2-login-code');

  // Wrong code shows a translated error.
  const code = await readOtp(page, phone);
  const wrong = code === '000000' ? '111111' : '000000';
  await page.getByLabel('الرمز').fill(wrong);
  await page.getByRole('button', { name: 'تأكيد' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'الرمز غلط. اتأكد منه وحاول تاني.',
  );

  await page.getByLabel('الرمز').fill(code);
  await page.getByRole('button', { name: 'تأكيد' }).click();

  // New users complete their profile first.
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('كمّل بياناتك');
  await snap(page, info, '3-onboarding');

  await page.getByLabel('الاسم الظاهر').fill('أبو محمد 0912345678');
  await page.getByLabel('المدينة').selectOption({ label: 'بورتسودان' });
  await page.getByRole('button', { name: 'حفظ ومتابعة' }).click();
  await expect(page.getByText('ما تكتب رقم تلفون أو رابط في الاسم.')).toBeVisible();

  await page.getByLabel('الاسم الظاهر').fill('أبو محمد');
  await page.getByRole('button', { name: 'حفظ ومتابعة' }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText('أبو محمد').first()).toBeVisible();
  await expect(page.getByText('الجهاز ده')).toBeVisible();
  await snap(page, info, '4-account');

  // The session cookie is httpOnly: page scripts can't read it.
  expect(await page.evaluate(() => document.cookie)).not.toContain('sq_sid');

  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login$/);

  expect(violations).toEqual([]);
});

test('avatar upload shows the new photo', async ({ page }) => {
  const phone = randomLocalPhone();
  await page.goto('/login');
  await page.getByLabel('رقم الموبايل').fill(phone);
  await page.getByRole('button', { name: 'أرسل الرمز' }).click();
  await page.getByLabel('الرمز').fill(await readOtp(page, phone));
  await page.getByRole('button', { name: 'تأكيد' }).click();
  await page.getByLabel('الاسم الظاهر').fill('Sara');
  await page.getByLabel('المدينة').selectOption({ label: 'كسلا' });
  await page.getByRole('button', { name: 'حفظ ومتابعة' }).click();
  await expect(page).toHaveURL(/\/account$/);

  // 1×1 red PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64',
  );
  await page
    .locator('#avatar')
    .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  const img = page.getByRole('img', { name: 'صورتك الشخصية' });
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('src', /^\/api\/media\//);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(256);
});
