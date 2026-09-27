import { describe, expect, it } from 'vitest';
import { MAX_PRICE_MINOR, minorToDecimalString, parsePriceInput } from './money';

describe('parsePriceInput', () => {
  it.each([
    ['1', 100n],
    ['15000', 1_500_000n],
    ['15,000', 1_500_000n],
    ['15 000', 1_500_000n],
    ['١٥٠٠٠', 1_500_000n],
    ['١٥٬٠٠٠', 1_500_000n],
    ['99.5', 9_950n],
    ['99.05', 9_905n],
    ['٩٩٫٥', 9_950n],
    ['0.01', 1n],
  ])('parses %s', (input, expected) => {
    expect(parsePriceInput(input)).toBe(expected);
  });

  it.each(['', 'abc', '0', '0.00', '-5', '1.234', '1e5', '12.', '.5', '100000000001'])(
    'rejects %s',
    (input) => {
      expect(parsePriceInput(input)).toBeNull();
    },
  );

  it('accepts the maximum and nothing above it', () => {
    expect(parsePriceInput('10000000000')).toBe(MAX_PRICE_MINOR);
    expect(parsePriceInput('10000000000.01')).toBeNull();
  });
});

describe('minorToDecimalString', () => {
  it.each([
    [0n, '0'],
    [100n, '1'],
    [150n, '1.50'],
    [105n, '1.05'],
    [1_500_000n, '15000'],
    [-250n, '-2.50'],
    [123_456_789_012_345_678n, '1234567890123456.78'],
  ])('%s → %s', (minor, text) => {
    expect(minorToDecimalString(minor)).toBe(text);
  });
});
