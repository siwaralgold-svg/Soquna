import { describe, expect, it } from 'vitest';
import { normalizeForSearch, searchTokens, toPrefixTsQuery } from './search';

describe('normalizeForSearch', () => {
  it.each([
    ['أحمد', 'احمد'],
    ['إبريق', 'ابريق'],
    ['آلة', 'اله'],
    ['ٱلقمر', 'قمر'],
    ['مكتبة', 'مكتبه'],
    ['مستشفى', 'مستشفي'],
    ['مُحَمَّدٌ', 'محمد'],
    ['جمـــيل', 'جميل'],
    ['iPhone 13 Pro', 'iphone 13 pro'],
    ['٢٥٦ جيجا', '256 جيجا'],
    ['كرسي،  طاولة!!', 'كرسي طاوله'],
    ['الموبايل', 'موبايل'],
    ['ال', 'ال'],
    ['الى', 'الي'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeForSearch(input)).toBe(expected);
  });

  it('makes spelling variants match each other', () => {
    expect(normalizeForSearch('الأدوات المنزلية')).toBe(normalizeForSearch('ادوات منزليه'));
  });
});

describe('searchTokens', () => {
  it('splits, deduplicates and caps the number of words', () => {
    expect(searchTokens('ايفون ايفون ١٣')).toEqual(['ايفون', '13']);
    expect(searchTokens('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('toPrefixTsQuery', () => {
  it('ANDs every word as a prefix match', () => {
    expect(toPrefixTsQuery('ايفون ١٣')).toBe('ايفون:* & 13:*');
  });

  it('cannot inject tsquery operators', () => {
    expect(toPrefixTsQuery("a | b & !c:* ' ( )")).toBe('a:* & b:* & c:*');
  });

  it('returns null when there is nothing to search for', () => {
    expect(toPrefixTsQuery('  !!! ')).toBeNull();
  });
});
