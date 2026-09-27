import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  newTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from '../src/lib/totp';

// RFC 6238 appendix B: SHA-1 key "12345678901234567890". The RFC lists 8 digits; we use the last 6.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('at %i s the code is %s', (seconds, code) => {
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(code);
  });

  it('round-trips base32 and refuses junk', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Decode('gezd gnbv')).toEqual(base32Decode('GEZDGNBV'));
    expect(() => base32Decode('01')).toThrow();
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts one step of clock drift either way, not more', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBeNull();
  });

  it('builds the link authenticator apps read', () => {
    expect(otpauthUri('ABC', 'Amna')).toBe(
      'otpauth://totp/Souqna%3AAmna?secret=ABC&issuer=Souqna&algorithm=SHA1&digits=6&period=30',
    );
  });
});
