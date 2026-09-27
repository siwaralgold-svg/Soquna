// Creates .env from .env.example, filling in random development secrets.
// Safe to run again: an existing .env is left alone.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../.env', import.meta.url);
const example = new URL('../.env.example', import.meta.url);

if (existsSync(target)) {
  console.log('.env already exists; leaving it unchanged.');
  process.exit(0);
}

let text = readFileSync(example, 'utf8').replaceAll('__GENERATE__', () =>
  randomBytes(32).toString('base64'),
);

// In GitHub Codespaces the app is opened on a forwarded https URL, not localhost.
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env;
if (CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
  const origin = `https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
  text = text.replace(/^APP_ORIGIN=.*$/m, `APP_ORIGIN=${origin},http://localhost:3000`);
}

writeFileSync(target, text, { mode: 0o600 });
console.log('Created .env with fresh development secrets.');
