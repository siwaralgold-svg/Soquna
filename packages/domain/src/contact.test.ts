import { describe, expect, it } from 'vitest';
import { containsContactInfo } from './contact';

describe('containsContactInfo', () => {
  it.each([
    'اتصل 0912345678',
    'call 0912 345 678',
    'واتساب +249-91-234-5678',
    'رقمي ٠٩١٢٣٤٥٦٧٨',
    '00249912345678',
    'see https://example.org',
    'www.shop.sd',
    'wa.me/249912345678',
    't.me/seller',
    'visit myshop.com today',
  ])('flags %s', (text) => {
    expect(containsContactInfo(text)).toBe(true);
  });

  it.each([
    'iPhone 13 Pro 256GB',
    'مقاس 42، موديل 2021',
    'السعر 150000 جنيه',
    'Samsung A52 - 8GB RAM',
    'e.g. very clean',
  ])('allows %s', (text) => {
    expect(containsContactInfo(text)).toBe(false);
  });
});
