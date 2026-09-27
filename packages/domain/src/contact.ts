import { toAsciiDigits } from './digits';

const LINK = /(https?:\/\/|www\.|wa\.me|t\.me|\b[\w-]+\.(com|net|org|sd|me|io|app)\b)/i;
/** 9+ digits, optionally separated by spaces, dots or dashes, e.g. 0912 345 678 or +249-91… */
const PHONE = /(?:\+|00)?\d(?:[\s.-]?\d){8,}/;

/**
 * True when text contains a phone number or a link. Public text (listings, and later chat
 * before an order exists) must not carry these: they move deals off the platform and out of
 * escrow, which is how most scams start. Short numbers like "iPhone 13 256GB" are fine.
 */
export function containsContactInfo(text: string): boolean {
  const ascii = toAsciiDigits(text);
  return PHONE.test(ascii) || LINK.test(ascii);
}
