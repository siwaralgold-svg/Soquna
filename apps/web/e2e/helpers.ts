import { expect, type Page } from '@playwright/test';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/** Fails if the page is wider than the screen (a common RTL layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'page must not scroll sideways').toBeLessThanOrEqual(clientWidth);
}

/** Collects CSP violations reported by the browser while the test runs. */
export function watchCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

export function randomLocalPhone(): string {
  return `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

/** Converts ASCII digits to Arabic-Indic digits, the way many Arabic keyboards type them. */
export function toArabicDigits(value: string): string {
  return value.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}
