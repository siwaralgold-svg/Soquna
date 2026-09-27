import { toAsciiDigits } from './digits';

/*
 * Search normalisation. The database has an identical SQL function, `souqna_normalize`
 * (migration 0002); a test runs both on the same inputs to keep them in step.
 *
 * 1. lower-case, Arabic-Indic digits → 0-9
 * 2. أ إ آ ٱ → ا,  ة → ه,  ى → ي
 * 3. strip tashkeel (harakat) and tatweel
 * 4. anything that isn't a-z, 0-9 or an Arabic letter becomes a space
 * 5. drop a leading "ال" from words that stay at least 2 letters long,
 *    so "الموبايل" and "موبايل" match
 */
export function normalizeForSearch(input: string): string {
  const cleaned = toAsciiDigits(input.toLowerCase())
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[^0-9a-zء-ي]+/g, ' ')
    .trim();
  return cleaned.replace(/(^| )ال(\S{2,})/g, '$1$2');
}

export function searchTokens(input: string, max = 8): string[] {
  const tokens = normalizeForSearch(input).split(' ').filter(Boolean);
  return [...new Set(tokens)].slice(0, max);
}

/**
 * Builds a Postgres tsquery string where every word must match as a prefix
 * ("ايف" finds "ايفون"). Tokens only contain [0-9a-z] and Arabic letters, so they
 * can't inject tsquery syntax. Returns null when there is nothing to search for.
 */
export function toPrefixTsQuery(input: string): string | null {
  const tokens = searchTokens(input);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(' & ');
}
