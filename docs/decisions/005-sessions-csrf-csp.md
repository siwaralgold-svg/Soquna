# 005 — Same-origin API, session cookie, CSRF and CSP

Status: Accepted (Phase 1)

## Context

Sessions must be httpOnly cookies that can be revoked at once. Every write must be protected against cross-site requests. Pages need a strict Content Security Policy.

## Decision

- **Same origin.** The browser only calls `/api/*` on the web app's own address. Next.js rewrites those requests to the Fastify API. The API never enables CORS.
- **Session cookie** `sq_sid`: a 32-byte random token, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. Only its SHA-256 hash is stored. Sessions end after 90 days, or after 30 days without use. Logging in rotates the session (any previous session in that browser is revoked).
- **CSRF**: every non-GET request must carry the header `x-souqna-csrf: 1`. A cross-site page can't add a custom header without a CORS preflight, which we never allow. As a second layer, the `Origin` header must be in `APP_ORIGIN` (or, if absent, `Sec-Fetch-Site` must be `same-origin`).
- **CSP**: `proxy.ts` creates a new random nonce for every page request. Scripts run only with that nonce (`'strict-dynamic'`, no `unsafe-inline`), with `object-src 'none'` and `frame-ancestors 'none'`. API responses use `default-src 'none'`. Every page is rendered per request so it can carry the nonce.
- **Media** is served through the API (`/api/media/:id`) from a private bucket. Only avatars are served for now; each new media type will get its own access rule.

## Consequences

- No CDN caching of HTML pages, which is fine for an app that is mostly personal screens.
- Codespaces URLs must be listed in `APP_ORIGIN`. `pnpm setup` adds them automatically.
