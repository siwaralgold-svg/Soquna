import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@souqna/contracts';
import { formatServerMessage, messages } from './index';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('messages', () => {
  const ar = flatten(messages.ar);
  const en = flatten(messages.en);

  it('Arabic and English have the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
  });

  it('every message uses the same placeholders in both languages', () => {
    for (const key of Object.keys(ar)) {
      expect(placeholders(en[key]!), key).toEqual(placeholders(ar[key]!));
    }
  });

  it('has no empty messages', () => {
    for (const [key, value] of Object.entries({ ...ar, ...en })) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('has a message for every API error code', () => {
    for (const code of ERROR_CODES) {
      expect(messages.ar.errors).toHaveProperty(code);
    }
  });

  it('formats server messages', () => {
    expect(formatServerMessage('en', 'otpSms', { code: '123456' })).toContain('123456');
    expect(formatServerMessage('ar', 'otpSms', { code: '123456' })).toContain('123456');
  });
});
