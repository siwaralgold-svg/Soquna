import { normalizeForSearch } from './search';

export type ScreenAction = 'block' | 'review';

export interface ProhibitedTerm {
  term: string;
  action: ScreenAction;
}

export interface ScreenResult {
  action: 'ok' | ScreenAction;
  matched: string[];
}

/** Single words of 4+ letters also match longer forms ("مسدس" matches "مسدسات"). */
const PREFIX_MIN = 4;

/**
 * Keyword pre-screen for listing text (prohibited-items policy). `block` terms stop the
 * listing outright; `review` terms send it to a moderator. Matching is on whole normalised
 * words, so "gun" does not match "begun".
 */
export function screenText(text: string, terms: readonly ProhibitedTerm[]): ScreenResult {
  const normalised = normalizeForSearch(text);
  const padded = ` ${normalised} `;
  const words = normalised.split(' ');
  const matched: ProhibitedTerm[] = [];

  for (const t of terms) {
    const term = normalizeForSearch(t.term);
    if (!term) continue;
    const hit = term.includes(' ')
      ? padded.includes(` ${term} `)
      : words.some((w) => w === term || (term.length >= PREFIX_MIN && w.startsWith(term)));
    if (hit) matched.push(t);
  }

  const action = matched.some((m) => m.action === 'block')
    ? 'block'
    : matched.length > 0
      ? 'review'
      : 'ok';
  return { action, matched: matched.map((m) => m.term) };
}
