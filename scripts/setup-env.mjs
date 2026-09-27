// Creates .env from .env.example, filling in random development secrets.
// Safe to run again: an existing .env is left alone.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../.env', import.meta.url);
const example = new URL('../.env.example', import.meta.url);

let text = readFileSync(example, 'utf8').replaceAll('__GENERATE__', () =>
  randomBytes(32).toString('base64'),
);

// In GitHub Codespaces the app is opened on a forwarded https URL, not localhost.
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env;
if (CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
  const origin = `https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
  text = text.replace(/^APP_ORIGIN=.*$/m, `APP_ORIGIN=${origin},http://localhost:3000`);
}

try {
  // 'wx' fails if the file exists, so an existing .env is never overwritten.
  writeFileSync(target, text, { mode: 0o600, flag: 'wx' });
  console.log('Created .env with fresh development secrets.');
} catch (err) {
  if (err.code !== 'EEXIST') throw err;
  console.log('.env already exists; leaving it unchanged.');
}
