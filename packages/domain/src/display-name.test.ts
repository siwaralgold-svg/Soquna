import { describe, expect, it } from 'vitest';
import { cleanDisplayName, validateDisplayName } from './display-name';
import { toAsciiDigits } from './digits';

describe('cleanDisplayName', () => {
  it('collapses whitespace and strips direction marks', () => {
    expect(cleanDisplayName('  أم   \u200fأحمد  ')).toBe('أم أحمد');
  });
});

describe('validateDisplayName', () => {
  it.each(['أم أحمد', 'Sara K.', 'محمد 2'])('accepts %s', (name) => {
    expect(validateDisplayName(name)).toBeNull();
  });

  it('rejects names that are too short or too long', () => {
    expect(validateDisplayName(' ا ')).toBe('too_short');
    expect(validateDisplayName('ا'.repeat(41))).toBe('too_long');
  });

  it.each(['Ali 0912345678', 'علي ٠٩١٢٣٤٥', 'shop www.example', 'best.com deals', 'call 12 34 56'])(
    'rejects contact details in %s',
    (name) => {
      expect(validateDisplayName(name)).toBe('contains_contact');
    },
  );

  it('rejects markup and handles', () => {
    expect(validateDisplayName('<b>Ali</b>')).toBe('invalid_chars');
    expect(validateDisplayName('ali@shop')).toBe('invalid_chars');
  });
});

describe('toAsciiDigits', () => {
  it('leaves other characters alone', () => {
    expect(toAsciiDigits('abc ١٢٣ ۴۵۶ 789')).toBe('abc 123 456 789');
  });
});
