# 008 — Arabic search, listing screening and moderation

Status: Accepted (Phase 2)

## Search

- Postgres full-text search with the `simple` configuration (no stemming) over a normalised copy of title (weight A) and description (weight B), stored in a generated `tsvector` column with a GIN index.
- Normalisation (`souqna_normalize` in SQL, `normalizeForSearch` in TypeScript, kept identical by a test): lower-case; Arabic-Indic digits → 0-9; أ/إ/آ/ٱ → ا; ة → ه; ى → ي; strip tashkeel and tatweel; drop a leading "ال" from words that stay at least 2 letters long.
- Every search word matches as a prefix (`ايف` finds `ايفون`). Words are reduced to letters and digits before building the tsquery, so user input cannot inject query syntax.
- Offset pagination, 20 per page, capped at page 50. That's enough for the MVP; keyset pagination can replace it if data grows.
- Pages are rendered on the server and the filter form is a plain GET form, so search works without JavaScript.

## Screening and moderation

- A listing's title and description may not contain phone numbers (9+ digits) or links. They move deals out of escrow, which is how most scams start.
- Keyword pre-screen from `prohibited_terms`: `block` terms reject the listing (`422 listing_prohibited`); `review` terms send it to `pending_review`. Matching is on whole normalised words, and single words of 4+ letters also match longer forms. Terms were chosen to avoid common false positives (e.g. "رصاص" was left out because it also matches "رصاصي", the colour grey).
- Three reports from different people hide a listing (`flag_for_review`) until a moderator decides.
- Every status change goes through the listing state machine in `packages/domain/src/listing.ts`.
- Until the admin screens (with mandatory 2FA) arrive in Phase 6, moderation is a command-line tool (`pnpm moderate`) that only people with server access can run. Every decision goes to the audit log.

## Anti-fraud limits

- A seller needs a completed profile to post.
- Accounts younger than 7 days can have at most 5 unfinished listings; older accounts 100.

## Consequences

- The keyword list is a first filter, not a guarantee. Reports and moderators catch the rest.
- Keyword and category lists need a Sudanese reviewer (see open questions).
