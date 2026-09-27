import { toAsciiDigits } from './digits';
import { screenText, type ProhibitedTerm } from './prohibited';

/** Whole links: URLs, bare domains, WhatsApp/Telegram short links. */
const LINK =
  /(https?:\/\/\S+|www\.\S+|wa\.me\/?\S*|t\.me\/?\S*|\b[\w-]+\.(com|net|org|sd|me|io|app)\b\S*)/gi;
/** 9+ digits, optionally separated by spaces, dots or dashes, e.g. 0912 345 678 or +249-91… */
const PHONE = /(?:\+|00)?\d(?:[\s.-]?\d){8,}/g;
/** Social handles such as @seller_2024. */
const HANDLE = /(^|\s)@[\w.]{4,}/g;

export const MASK = '•••';

/**
 * True when text contains a phone number or a link. Public text (listings, and chat before an
 * order exists) must not carry these: they move deals off the platform and out of escrow,
 * which is how most scams start. Short numbers like "iPhone 13 256GB" are fine.
 */
export function containsContactInfo(text: string): boolean {
  const ascii = toAsciiDigits(text);
  return new RegExp(PHONE.source).test(ascii) || new RegExp(LINK.source, 'i').test(ascii);
}

/** Replaces phone numbers, links and handles with •••. Arabic-Indic digits become 0-9. */
export function maskContactInfo(text: string): { text: string; masked: boolean } {
  const ascii = toAsciiDigits(text);
  const masked = ascii
    .replace(PHONE, MASK)
    .replace(LINK, MASK)
    .replace(HANDLE, (_m, space: string) => `${space}${MASK}`);
  return { text: masked, masked: masked !== ascii };
}

/**
 * Phrases that usually mean "let's pay/talk outside the app". They are not blocked (people
 * mention Bankak legitimately), but the other person sees a warning and a fraud flag is raised.
 */
export const OFF_PLATFORM_PHRASES: readonly ProhibitedTerm[] = [
  'حول لي',
  'حولي',
  'حوله لي',
  'بنكك',
  'كاش',
  'بره التطبيق',
  'برا التطبيق',
  'خارج التطبيق',
  'واتساب',
  'واتس',
  'تلغرام',
  'تيليجرام',
  'رقمي',
  'bankak',
  'whatsapp',
  'telegram',
  'pay me directly',
  'outside the app',
  'send money',
  'cash only',
].map((term) => ({ term, action: 'review' as const }));

export function mentionsOffPlatformPayment(text: string): boolean {
  return screenText(text, OFF_PLATFORM_PHRASES).action !== 'ok';
}

export type ChatFlag = 'contact_masked' | 'off_platform';

/**
 * Prepares a chat message before an order exists: contact details are masked (the original is
 * never stored) and risky phrasing is flagged.
 */
export function prepareChatText(text: string): { text: string; flags: ChatFlag[] } {
  const { text: masked, masked: didMask } = maskContactInfo(text.trim());
  const flags: ChatFlag[] = [];
  if (didMask) flags.push('contact_masked');
  if (mentionsOffPlatformPayment(text)) flags.push('off_platform');
  return { text: masked, flags };
}
