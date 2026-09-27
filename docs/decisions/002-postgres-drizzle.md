# 002 — PostgreSQL with Drizzle ORM and SQL migrations

Status: Accepted (Phase 0)

## Context

The ledger and state machine need guarantees from the database itself: append-only tables, a zero-sum check per ledger transaction, a lock that stops double-selling, and `SELECT … FOR UPDATE`.

## Decision

- PostgreSQL 16, accessed through Drizzle ORM.
- Triggers, check constraints, and partial unique indexes are written as plain SQL migrations.
- Money is `bigint` minor units everywhere. It is a `bigint` in TypeScript and a string in JSON.

## Consequences

- Some logic lives in SQL and is covered by integration tests that run against a real Postgres (in Codespaces and CI).
- No mutable balance columns. Balances are always a `SUM` over ledger entries.
