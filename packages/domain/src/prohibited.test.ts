import { describe, expect, it } from 'vitest';
import { screenText, type ProhibitedTerm } from './prohibited';

const TERMS: ProhibitedTerm[] = [
  { term: 'مسدس', action: 'block' },
  { term: 'gun', action: 'block' },
  { term: 'دواء', action: 'review' },
  { term: 'رقم وطني', action: 'block' },
];

describe('screenText', () => {
  it('passes normal listings', () => {
    expect(screenText('كرسي خشب بحالة ممتازة', TERMS)).toEqual({ action: 'ok', matched: [] });
  });

  it('blocks prohibited words, including longer forms and spelling variants', () => {
    expect(screenText('مسدسات للبيع', TERMS).action).toBe('block');
    expect(screenText('Toy GUN', TERMS).action).toBe('block');
  });

  it('matches whole words only', () => {
    expect(screenText('The game has begun', TERMS).action).toBe('ok');
  });

  it('matches multi-word terms as a phrase', () => {
    expect(screenText('بطاقة الرقم الوطني', TERMS).action).toBe('block');
    expect(screenText('رقم الموديل وطني', TERMS).action).toBe('ok');
  });

  it('sends review-only terms to moderation', () => {
    expect(screenText('دواء ضغط', TERMS)).toEqual({ action: 'review', matched: ['دواء'] });
  });

  it('block wins over review and lists every match', () => {
    expect(screenText('مسدس و دواء', TERMS)).toEqual({
      action: 'block',
      matched: ['مسدس', 'دواء'],
    });
  });

  it('ignores empty terms', () => {
    expect(screenText('anything', [{ term: ' ', action: 'block' }]).action).toBe('ok');
  });
});
