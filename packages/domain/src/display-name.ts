import { toAsciiDigits } from './digits';

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

export type DisplayNameError = 'too_short' | 'too_long' | 'contains_contact' | 'invalid_chars';

/** Collapses whitespace and strips invisible direction/format characters. */
export function cleanDisplayName(input: string): string {
  return input
    .normalize('NFC')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Display names are public, so they must not carry phone numbers, links or handles
 * that would move a deal off the platform (and out of escrow).
 */
export function validateDisplayName(input: string): DisplayNameError | null {
  const name = cleanDisplayName(input);
  const length = [...name].length;
  if (length < DISPLAY_NAME_MIN) return 'too_short';
  if (length > DISPLAY_NAME_MAX) return 'too_long';
  if (/[<>{}[\]\\/@]/.test(name)) return 'invalid_chars';

  const digitCount = (toAsciiDigits(name).match(/\d/g) ?? []).length;
  if (digitCount >= 5) return 'contains_contact';
  if (/(https?:|www\.|\.com\b|\.net\b|\.sd\b)/i.test(name)) return 'contains_contact';
  return null;
}
