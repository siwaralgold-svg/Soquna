#!/usr/bin/env bash
# Runs once when the Codespace is created: installs dependencies and prepares the database.
set -euo pipefail

sudo corepack enable
corepack prepare --activate

pnpm install --frozen-lockfile

# Development .env with freshly generated random secrets.
node scripts/setup-env.mjs

# Wait for Postgres, then create tables and seed cities.
for _ in $(seq 1 30); do
  (echo > /dev/tcp/postgres/5432) 2>/dev/null && break
  sleep 1
done
pnpm db:migrate
pnpm db:seed

# Browser for the end-to-end tests.
pnpm --filter @souqna/web exec playwright install --with-deps chromium

echo
echo "Ready. Start the app with:  pnpm dev"
