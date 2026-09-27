# CLAUDE.md — rules for working in this repo

The full product brief is in **PROMPT.md**. Read it before doing anything.

## Working rules
- Work **one phase at a time** (see PROMPT.md §6). Stop at the end of each phase, summarise, and wait for approval.
- Phase 0 is planning only. **Do not write application code until the plan is approved.**
- Everything must run in **GitHub Codespaces**. The owner's laptop is a 2014 MacBook Pro, so there is no local dev.
- Explain run/setup steps using the exact names of buttons and settings as they appear on screen.

## Non-negotiables
- Money = integer minor units (`bigint`), double-entry ledger, never floats, never a mutable balance column.
- Order/escrow changes go **only** through the state machine, and every transition is logged to `order_events`.
- Every write endpoint for payments/orders is idempotent.
- Arabic-first, RTL, all UI text in i18n files.
- Phone numbers, exact addresses, and ID documents are never exposed beyond the roles allowed in PROMPT.md §7.
- No secrets in git. Use `.env.example` with placeholders only.
- Tests are required for the state machine, ledger, and authorisation (IDOR) checks.
