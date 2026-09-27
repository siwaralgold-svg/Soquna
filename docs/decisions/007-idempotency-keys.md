# 007 — Idempotency keys for retry-safe writes

Status: Accepted (Phase 2)

## Context

Networks in Sudan drop often. A seller who taps "Publish" and loses signal can't tell whether the listing was created, and the phone may retry. Later, the same problem hits payments and orders (Phase 4), where a duplicate is much worse.

## Decision

- Writes that create things take an `Idempotency-Key` header (16–128 URL-safe characters, random per user action). For now that's `POST /api/listings`; payments and orders will use the same hooks.
- The first request is recorded in `idempotency_keys` (per user + key, with a hash of method, route, params and body). Its response is stored when it finishes.
- A retry with the same key and body gets the stored response back, with the `idempotent-replayed: true` header. It does not run again.
- The same key with a different body, or while the first request is still running, gets `409 idempotency_conflict`. A request stuck "running" for over 60 s is treated as crashed and may be retried.
- 5xx responses are not stored, so the client can retry after a server failure.
- The web app keeps one key per attempt. It reuses the key for retries after network errors, and makes a new key once the server has given a definite (4xx) answer, e.g. after the seller fixes a validation error.

## Consequences

- Stored keys pile up. A cleanup job (worker, Phase 4) will delete keys older than 24 hours.
- Keys are stored in Postgres, not Redis, so they survive restarts. That matters for payments.
