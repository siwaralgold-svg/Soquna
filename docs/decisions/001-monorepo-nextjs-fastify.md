# 001 — Monorepo with Next.js web app and separate Fastify API

Status: Accepted (Phase 0)

## Context

We need a mobile-first PWA, realtime chat with a polling fallback, background timers, and an API a future native app can reuse. All of it must run in GitHub Codespaces.

## Decision

- pnpm workspaces monorepo: `apps/web` (Next.js App Router), `apps/api` (Fastify; Socket.IO arrives with chat in Phase 3), `apps/worker` (BullMQ; created in Phase 4 when the first timers exist).
- Business rules live in `packages/domain` (pure TypeScript, no I/O), so the API and worker run the same code.
- Web and API are served from the same domain (`/api/*` → Fastify), so cookies stay first-party and no CORS is needed.

## Consequences

- Two deployable services instead of one.
- Socket.IO gives the long-polling fallback without extra work.
- A native app can use the same API later.
