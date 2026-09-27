# 003 — Single transition function for orders, double-entry ledger

Status: Accepted (Phase 0)

## Context

Escrow is the core promise. Order status and money must never get out of step, including when two requests or two timer runs arrive at the same time.

## Decision

- All allowed order transitions are defined as data in one file. One `transition()` function locks the order row (`FOR UPDATE`), checks the guard, updates the status, writes `order_events`, and posts ledger entries, all in one DB transaction.
- Double-entry ledger with signed `bigint` entries (+debit / −credit). A deferred trigger checks that each transaction sums to zero.
- Timers are deadlines stored on the order plus a worker that calls the same `transition()` with `FOR UPDATE SKIP LOCKED`. Running twice is harmless because the second run finds the status already changed.
- Accounts added beyond PROMPT.md: `platform_bank`, `seller_pending:{id}`, `payouts_in_flight`, `courier_earnings:{id}`.

## Consequences

- 100% transition/branch coverage is feasible, because the rules are data plus a small pure function.
- Mistakes are corrected with reversing entries, never edits.
