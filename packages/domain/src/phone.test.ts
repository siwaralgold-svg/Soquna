import { describe, expect, it } from 'vitest';
import { maskPhone, normalizeSudanPhone } from './phone';

describe('normalizeSudanPhone', () => {
  it.each([
    ['0912345678', '+249912345678'],
    ['091 234 5678', '+249912345678'],
    ['091-234-5678', '+249912345678'],
    ['+249912345678', '+249912345678'],
    ['00249912345678', '+249912345678'],
    ['249912345678', '+249912345678'],
    ['912345678', '+249912345678'],
    ['0123456789', '+249123456789'],
    ['٠٩١٢٣٤٥٦٧٨', '+249912345678'],
    ['۰۹۱۲۳۴۵۶۷۸', '+249912345678'],
    ['\u200e+249 99 123 4567', '+249991234567'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeSudanPhone(input)).toBe(expected);
  });

  it.each([
    [''],
    ['abc'],
    ['091234567'],
    ['09123456789'],
    ['+971501234567'],
    ['0512345678'],
    ['+249512345678'],
    ['09x2345678'],
    ['+ 249'],
  ])('rejects %s', (input) => {
    expect(normalizeSudanPhone(input)).toBeNull();
  });
});

describe('maskPhone', () => {
  it('keeps only the network digit and the last three digits', () => {
    expect(maskPhone('+249912345678')).toBe('+249 9•• ••• 678');
  });

  it('masks non-Sudanese numbers too', () => {
    expect(maskPhone('+971501234567')).toBe('+97••••567');
  });

  it('handles junk input', () => {
    expect(maskPhone('12')).toBe('•••');
  });
});
