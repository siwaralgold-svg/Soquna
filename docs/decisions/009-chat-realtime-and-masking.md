# 009 — Chat, realtime delivery and contact masking

Status: Accepted (Phase 3)

## Shape

- One conversation per (listing, buyer). Starting a chat again returns the same conversation. A seller only sees it after the buyer's first message, so empty chats don't clutter their inbox.
- Messages are `text`, `image` or `offer`. Ids come from a `bigserial`, so the client pages with `?before=` / `?after=` without timestamps.
- Every chat route checks that the caller is the buyer or the seller of that conversation and answers `404` otherwise (no IDOR). Chat photos are `private` media, visible only to the uploader and the two people in the conversation they were sent in.
- New accounts' spam is limited: 30 new conversations a day, 60 messages a minute, 60 chat photos an hour.

## Realtime

- Socket.IO on the API at `/api/socket.io`, reached through the same Next.js `/api` proxy as everything else, so cookies stay first-party. It starts with HTTP long-polling and upgrades to a WebSocket when the network allows. That is the "polling fallback" from the brief.
- The socket only **pushes** (`chat:message`, `chat:message-updated`). Sending always goes through the HTTP API, which is validated, rate-limited and idempotent (`Idempotency-Key`), so a retried message is never stored twice.
- The handshake reuses the session cookie. Foreign origins are refused (WebSocket hijacking). Logging out, or ending a device's session, closes that session's live connections straight away.
- A Redis adapter lets several API instances share rooms. Long-polling needs sticky sessions behind a load balancer; we'll configure that when there is more than one instance (Phase 7).
- The web client loads `socket.io-client` only when a signed-in page needs it, so it never counts toward first-load JS. After a reconnect, and every 15 s while disconnected, the chat screen re-fetches what it missed.

## Outbox

- A sent message appears at once and waits in an outbox (kept in IndexedDB, photos included) until the server confirms it. Network errors, 429 and 5xx retry automatically with the **same** idempotency key when the phone comes back online. Other 4xx answers are final: the message shows "Not sent" with a Delete button.

## Masking and fraud flags

- Before an order exists, phone numbers (Arabic or Western digits, with spaces or dashes) and links or `@handles` are replaced with `•••` **on the server before storing**. The original is never kept, so it can't leak through the API, notifications or a database dump.
- Phrases that push payment off the platform ("حوّل لي", "بنكك", "كاش", "واتساب", "pay me directly"…) are allowed but flagged. Both people see a warning under the message, and a `fraud_flags` row goes to the fraud queue (the admin screens come in Phase 6).
- Phase 4 will relax masking for the two people once an order between them is paid into escrow and delivery needs a phone number.

## Offers

- Offer states: `pending → accepted | declined | withdrawn | expired`, enforced by the state machine in `packages/domain/src/offer.ts`. Only the seller accepts or declines, and only the buyer withdraws.
- At most one pending offer per conversation (a partial unique index). An offer must be above 0 and no more than the asking price, and only on active, negotiable listings. Offers expire after 48 h.
- Accepting an offer doesn't reserve the item or move money. Phase 4 turns an accepted offer into an order at that price, through the order state machine.

## Consequences

- Masked text can't be un-masked later. That's deliberate.
- Keyword flags will have false positives. They only warn and queue for review; they never block.
