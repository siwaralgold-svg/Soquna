import { toAsciiDigits } from './digits';

/** Sudanese pound: 1 SDG = 100 piastres. All money is stored as bigint minor units. */
export const SDG_MINOR_PER_MAJOR = 100n;

/** Upper bound for a listing price: 10 billion SDG. Guards against typos and overflow. */
export const MAX_PRICE_MINOR = 10_000_000_000n * SDG_MINOR_PER_MAJOR;

/**
 * Parses a price typed by a user into minor units.
 * Accepts ASCII or Arabic-Indic digits, thousands separators (`,` `٬` spaces) and up to two
 * decimals after `.` or `٫`. Returns null for anything else, zero, or above the maximum.
 */
export function parsePriceInput(input: string): bigint | null {
  const text = toAsciiDigits(input)
    .replace(/[\s,\u066C]/g, '')
    .replace(/\u066B/g, '.');
  const match = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const major = BigInt(match[1]!);
  const minor = BigInt((match[2] ?? '').padEnd(2, '0'));
  const total = major * SDG_MINOR_PER_MAJOR + minor;
  if (total <= 0n || total > MAX_PRICE_MINOR) return null;
  return total;
}

/**
 * Minor units → decimal string ("1234.5" style, no grouping), exact for any size.
 * Feed it to Intl.NumberFormat for display; never convert money through a float.
 */
export function minorToDecimalString(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const major = abs / SDG_MINOR_PER_MAJOR;
  const cents = abs % SDG_MINOR_PER_MAJOR;
  const text = cents === 0n ? major.toString() : `${major}.${cents.toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}
