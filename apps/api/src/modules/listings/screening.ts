import { prohibitedTerms } from '@souqna/db';
import { screenText, type ProhibitedTerm, type ScreenResult } from '@souqna/domain';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../../context';

const CACHE_MS = 60_000;
let cache: { at: number; terms: ProhibitedTerm[] } | null = null;

/** Prohibited-items keyword screen over a listing's title and description. */
export async function screenListing(
  ctx: AppContext,
  text: { title: string; description: string },
): Promise<ScreenResult> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const rows = await ctx.db
      .select({ term: prohibitedTerms.term, action: prohibitedTerms.action })
      .from(prohibitedTerms)
      .where(eq(prohibitedTerms.active, true));
    cache = { at: Date.now(), terms: rows };
  }
  return screenText(`${text.title}\n${text.description}`, cache.terms);
}

/** For tests and admin changes: forget the cached term list. */
export function clearScreeningCache(): void {
  cache = null;
}
