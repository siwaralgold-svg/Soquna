# 010 — Orders, escrow and the ledger in practice

Status: Accepted (Phase 4). Builds on [003](003-order-state-machine-and-ledger.md).

## State machine

- Every allowed move is one row in `ORDER_TRANSITIONS` (`packages/domain/src/order.ts`): event, from-statuses, to-status, who may do it, an optional guard (payment/delivery method), and what happens to the listing. The tests compare it with the table in the Phase 0 plan written out by hand: every listed pair works, and every other (status, event) pair is refused for every actor and order type.
- `applyTransition()` (`apps/api/src/modules/orders/transition.ts`) is the only code that writes `orders.status`, and a test fails if any other file updates the `orders` table. In one DB transaction it locks the order (`FOR UPDATE`), checks the rule, moves the listing through the listing state machine, posts the ledger, starts the next deadline, bumps `version` and appends an `order_events` row.
- Double-sell protection has two layers: checkout locks the listing row, and a partial unique index allows only one active order per listing.
- Order writes from people are idempotent (`Idempotency-Key`). Each ledger transaction's key is `order:{id}:v{version}:{event}`, so the same money can never move twice, even if someone bypasses the HTTP layer.

## Ledger

- Postings (L1–L8 in the plan) are pure functions (`packages/domain/src/ledger.ts`), tested by replaying whole order lives and checking that escrow ends at exactly zero.
- The database is the last line: `order_events`, `ledger_transactions` and `ledger_entries` are append-only (triggers), and a deferred constraint trigger refuses, at commit, any transaction whose entries don't sum to zero or have fewer than two lines.
- Refunds post to a per-buyer `refunds:{buyer}` account (the plan had one shared account) so we always know whom to pay back. The actual bank transfers of refunds and seller payouts (L9–L11) come with the payout queue in Phase 6.
- Balances are always `SUM(entries)`. People see them as positive numbers (`displayBalance`).

## Fees and settings

- Buyer protection = fixed + % of the item price, rounded half up to a piastre, capped. Delivery: flat courier fee; 0 for meetups. Sellers pay nothing (the Vinted model).
- All numbers (fees, COD limit, new-account limit, timers, new-seller hold) are rows in `order_configs`. A new row with a later `effective_from` replaces the old one; rows are never edited. Each order keeps the row it was priced with, so changing fees never changes an existing order. The seeded values are **placeholders** until the owner decides.

## Timers

- Deadlines are columns on the order. Every minute the API runs `runOrderTimers()`, which calls the same `transition()` with `FOR UPDATE SKIP LOCKED` and re-checks the deadline under the lock. Running it twice, or on several servers at once, is harmless (tested).
- The loop runs inside the API process instead of a separate BullMQ worker (a change from the plan). It needs no extra process in Codespaces and can push live updates directly. A separate worker can take it over later without code changes, since it is one function.

## Anti-fraud at checkout

- Brand-new accounts (under 7 days) can't order above a cap. Buyers can have at most 3 unpaid orders at once.
- Cash on delivery needs a completed order and stays under a cap. Meetups must be prepaid, since cash at a meetup would bypass escrow.
- New sellers' first 3 completed orders are held 7 days before the money becomes withdrawable (`payout_released`).

## Consequences

- Courier pick-up/delivery, the 4-digit code and meetup hand-over (Phase 5), and disputes (Phase 6) already exist in the state machine and ledger. Those phases add screens and guards, not new money rules.
- A mistake is fixed with a new, reversing transaction by finance, never by editing rows.
