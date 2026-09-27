import { toAsciiDigits } from './digits';

export const SUDAN_COUNTRY_CODE = '249';

/**
 * Normalises a Sudanese mobile number to E.164 (+2499XXXXXXXX / +2491XXXXXXXX).
 * Accepts local (09…, 01…), international (+249…, 00249…, 249…) and Arabic-Indic digits.
 * Returns null when the input is not a Sudanese mobile number.
 */
export function normalizeSudanPhone(input: string): string | null {
  const cleaned = toAsciiDigits(input).replace(/[\s\-().\u200e\u200f]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) return null;

  let digits = cleaned.replace(/^\+/, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  let national: string;
  if (digits.startsWith(SUDAN_COUNTRY_CODE) && digits.length === 12) {
    national = digits.slice(3);
  } else if (digits.startsWith('0') && digits.length === 10) {
    national = digits.slice(1);
  } else if (digits.length === 9) {
    national = digits;
  } else {
    return null;
  }

  // Mobile networks: Zain (91, 96), MTN (92, 99), Sudani (11, 12).
  if (!/^(9[0-9]|1[0-9])\d{7}$/.test(national)) return null;
  return `+${SUDAN_COUNTRY_CODE}${national}`;
}

/** Masks a phone number for logs and support screens: +249 9•• ••• 123. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 6) return '•••';
  const last = digits.slice(-3);
  if (digits.startsWith(SUDAN_COUNTRY_CODE) && digits.length === 12) {
    return `+${SUDAN_COUNTRY_CODE} ${digits[3]}•• ••• ${last}`;
  }
  return `+${digits.slice(0, 2)}••••${last}`;
}
