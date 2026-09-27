import { describe, expect, it } from 'vitest';
import {
  containsContactInfo,
  maskContactInfo,
  mentionsOffPlatformPayment,
  prepareChatText,
} from './contact';

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

describe('maskContactInfo', () => {
  it.each([
    ['رقمي 0912345678 كلمني', 'رقمي ••• كلمني'],
    ['٠٩١٢٣٤٥٦٧٨', '•••'],
    ['0 9 1 2 3 4 5 6 7 8', '•••'],
    ['see https://evil.example/pay?x=1 now', 'see ••• now'],
    ['wa.me/249912345678', '•••'],
    ['my ig @seller.shop2024', 'my ig •••'],
    ['shop.sd/deal', '•••'],
  ])('%s → %s', (input, expected) => {
    expect(maskContactInfo(input)).toEqual({ text: expected, masked: true });
  });

  it('leaves ordinary messages alone', () => {
    expect(maskContactInfo('iPhone 13, 128GB, بكم آخر سعر؟')).toEqual({
      text: 'iPhone 13, 128GB, بكم آخر سعر؟',
      masked: false,
    });
  });

  it('does not treat an email-like "@" in a sentence as a handle unless it is a word', () => {
    expect(maskContactInfo('price @ 5000').masked).toBe(false);
  });
});

describe('prepareChatText', () => {
  it('masks contact details and flags off-platform payment talk', () => {
    expect(prepareChatText('  حوّل لي على بنكك 0912345678 ')).toEqual({
      text: 'حوّل لي على بنكك •••',
      flags: ['contact_masked', 'off_platform'],
    });
  });

  it.each(['نتكلم في الواتساب', 'Pay me directly please', 'cash only'])('flags "%s"', (text) => {
    expect(mentionsOffPlatformPayment(text)).toBe(true);
  });

  it('passes a normal question', () => {
    expect(prepareChatText('الموبايل لسه موجود؟')).toEqual({
      text: 'الموبايل لسه موجود؟',
      flags: [],
    });
  });
});
