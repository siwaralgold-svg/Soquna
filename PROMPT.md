# Souqna (سوقنا) — Master Build Prompt

> Paste this whole file into Claude Code (web) as your first message, or say:
> **"Read PROMPT.md and CLAUDE.md, then start Phase 0."**
> "Souqna" is a working name — change it anywhere you like.

---

## 1. What we are building

A **peer-to-peer marketplace for Sudan**, made for small, everyday sellers — not big stores.

- A person with one used table, a blender, or a game controller.
- A young woman who brings a few Korean beauty products home and resells them.
- A student selling a phone, a mother selling baby items, a craftsman selling a few handmade pieces.

Both **used and new** items are allowed. Anyone can sell; you do not need to be a registered business.

**The core promise:** *"You pay, we hold the money, you only release it when the item is in your hands and it's what you expected."*

### The core flow

1. **User A (seller)** posts a listing: photos, title, price, condition, category, and city/neighbourhood.
2. **User B (buyer)** browses or searches, opens the listing, and chats with the seller **inside the app** (phone numbers stay hidden).
3. B taps **Buy**. B pays the item price, the delivery fee, and a small buyer-protection fee.
4. **The platform holds the money (escrow).** The seller sees "Paid — money is held safely" and prepares the item.
5. **A delivery partner** (courier company or verified independent rider) picks the item up from A and takes it to B.
6. B inspects the item. At handover B gives the courier a **4-digit delivery code**, which confirms that the item was delivered.
7. B has an **inspection window** (default 48 hours, configurable) to either **Confirm OK** or **Report a problem**.
8. On confirmation, or automatically when the window ends with no complaint, the funds are **released to the seller's payout balance**. If B reports a problem, a **dispute** opens and an admin resolves it.
9. Both sides rate each other.

---

## 2. Learn from these platforms (study their patterns, don't copy their branding)

| Platform | What to take from it |
|---|---|
| **Mercari (JP/US)** | Payment held until the buyer rates. Seller has ~3 days to ship. Buyer has ~3 days after delivery to rate, then it **auto-completes**. Payout only after completion. |
| **Vinted (EU)** | Sellers list for **free**. The buyer pays a transparent **"Buyer Protection" fee** (fixed + %), which is how the platform earns. Very simple listing flow. |
| **Xianyu / Idle Fish (Alibaba, CN)** | C2C for ordinary people. **Trust/credit score** on profiles. Built-in chat. Feels social, like a feed. |
| **Taobao + Alipay (early days)** | The original escrow model: Alipay held funds until the buyer confirmed. This is what made strangers trust each other in a low-trust market. The model fits Sudan. |
| **Shopee Guarantee (SEA)** | Payment held until "Order Received". Automatic release timer. Clear order-status timeline. |
| **Carousell (SEA)** | Mobile-first, very fast "snap a photo and list" flow, and making offers. |
| **OpenSooq / Haraj / Dubizzle (Arab region)** | Arabic-first classifieds UX. Category trees that suit the region (cars, phones, furniture, abayas/fashion, beauty). |
| **Jiji (Africa)** | Safety tips shown in context. Works on cheap Android phones and slow networks. |

---

## 3. Sudan-specific realities (design for these from day one)

1. **Payments.**
   - Most digital payments go through **Bankak** (Bank of Khartoum's app), plus bank apps such as Fawry (Faisal Islamic Bank) and wallets such as Bravo.
   - These services **go down regularly**. In late Aug–early Sep 2026 there were Bankak outages, and people fell back to cash.
   - There is **no Stripe/PayPal** in Sudan.
   - So build a **pluggable `PaymentProvider` interface** with these adapters:
     - `ManualBankTransferProvider` (MVP): the buyer transfers to the platform's Bankak/bank account and submits the transaction reference plus an optional screenshot. An admin or finance user verifies it, and the escrow is then marked funded. Idempotent, with duplicate-reference detection.
     - `CashOnDeliveryEscrowProvider`: the courier collects cash from the buyer at the door **before** handing over the item, and the cash counts as held by the platform until the courier remits it. This needs a courier cash ledger and daily reconciliation.
     - `MockProvider` for development and tests.
     - Leave a stub for a future licensed gateway (e.g. a local PSP) with a signature-verified webhook handler.
2. **Currency.** Sudanese Pound (SDG) with high inflation. Store money as **integer minor units (`bigint`)**, never floats. Add a display option for "approx. USD" later behind a feature flag.
3. **Connectivity.** Networks are slow, expensive, and often cut.
   - **PWA** that installs to the home screen.
   - Aggressive image compression (WebP/AVIF, resized on upload, thumbnails).
   - Offline drafts for listings.
   - Optimistic UI with retry queues.
   - Every write endpoint idempotent (`Idempotency-Key` header).
   - Target: first load under 200 KB JS on a low-end Android over 3G.
4. **Language.** **Arabic-first, full RTL**, with English as the second language. The copy should sound like Sudanese everyday speech, but in clear Arabic. All strings go in i18n files. No hard-coded text.
5. **Displacement and cities.** People have moved because of the war. Operations may centre on cities such as Port Sudan, Kassala, Atbara, Omdurman, Wad Madani, and El Obeid.
   - Keep **cities and neighbourhoods as admin-editable data**, not hard-coded.
   - A listing shows only **city + neighbourhood**, never an exact address.
6. **Identity.** Many users have no email. Use **phone number + OTP (SMS)** as the main login. Keep the SMS provider pluggable, with a WhatsApp OTP fallback adapter stub.
7. **Delivery.** There is no national address system. Use:
   - landmarks + a neighbourhood + a map pin shared privately with the assigned courier only
   - riders on motorbikes, rickshaws (ركشة), and small courier companies
   - an **in-person meetup** option: the buyer still pays through escrow and gives the seller the delivery code when meeting.

---

## 4. Roles

- **Buyer / Seller:** the same account can do both.
- **Courier:** a separate verified role with a simple mobile view. Sees assigned jobs, pickup/drop-off details (revealed only after assignment), and enters the delivery code. Has a cash-on-delivery ledger.
- **Courier company admin** (later phase): manages its riders.
- **Platform Admin / Moderator:** approves flagged listings, verifies manual payments, handles disputes, bans users. **2FA is mandatory.**
- **Finance:** reconciles payments, courier cash, and payouts. Separate permission from moderation.

---

## 5. Order and escrow state machine (the heart of the system)

```
DRAFT_LISTING → ACTIVE_LISTING
ORDER: CREATED → AWAITING_PAYMENT → PAYMENT_SUBMITTED → FUNDS_HELD
       → READY_FOR_PICKUP → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
       → (inspection window) → COMPLETED → PAYOUT_RELEASED
Side paths: CANCELLED (before pickup, auto-refund) · PAYMENT_REJECTED · DELIVERY_FAILED
            DISPUTED → RESOLVED_REFUND | RESOLVED_PARTIAL | RESOLVED_RELEASE
            EXPIRED (seller didn't hand over within N days → auto-refund)
```

Rules:
- Implement it as an **explicit, tested state machine**. Allowed transitions are listed in one place, and every transition records who did it, when, and why in an append-only `order_events` table.
- **Double-entry ledger** for all money. Accounts: `buyer_payments_clearing`, `escrow_held`, `platform_fees`, `seller_balance:{id}`, `courier_cash:{id}`, `refunds`.
  - Balances are always computed from ledger entries, never stored as a mutable number.
  - Each transaction must sum to zero, enforced by a DB constraint or check plus tests.
- **Timers** (auto-complete, seller hand-over deadline, payment-submission deadline) run as background jobs that are safe to run twice.
- Payouts to sellers go into a **payout request queue** that finance approves. They are made by Bankak/bank transfer and marked paid with a reference.
- Once an item is in an active order, it **locks** ("Reserved") so it can't be sold twice.

---

## 6. Features by phase

### Phase 0 — Plan (NO code yet)
Read this file, then reply with:
- the proposed tech stack with justification
- the data model (ERD in Mermaid)
- the full state machine diagram
- the folder structure
- the list of open questions.

**Wait for my approval before writing code.**

### Phase 1 — Foundation
- Repo setup, a **GitHub Codespaces devcontainer** (my laptop is old, so everything must run in Codespaces), Docker Compose for Postgres + Redis, lint/format/typecheck, CI on GitHub Actions.
- i18n (ar default, RTL + en), design system tokens, PWA shell.
- Phone OTP auth, sessions, basic profile (display name, city, avatar).

### Phase 2 — Listings
- Create/edit listings: up to 8 photos, compressed on the client and server, **EXIF stripped** because GPS data leaks home locations.
- Category tree (admin-editable), condition (new / like new / good / fair), price, negotiable toggle.
- Search: full-text in Arabic + English using Postgres FTS with Arabic normalisation (أ/إ/آ→ا, ة→ه, ى→ي, strip tashkeel). Filters: city, category, price, condition. Sort by newest or price.
- Favourites. "Report listing" button.
- Prohibited-items policy: weapons, drugs, counterfeit medicine, animals, stolen goods, etc. Apply it with keyword pre-screening plus manual review.

### Phase 3 — Chat & offers
- In-app 1:1 chat per listing, over WebSocket with polling fallback.
- Images in chat, "Make an offer" message type, seller accept/decline.
- **Phone numbers and external links are masked** in chat before an order exists. This is anti-fraud and keeps payments inside escrow. Show safety tips in context.

### Phase 4 — Checkout, escrow & ledger
- Buy Now or buy at accepted offer.
- Fee breakdown: item price + delivery fee + buyer-protection fee. Fees are configurable, e.g. fixed + % with a cap.
- `ManualBankTransferProvider` flow + admin verification screen. `CashOnDeliveryEscrowProvider`. `MockProvider`.
- Ledger, state machine, timers, order timeline UI for buyer and seller.

### Phase 5 — Delivery
- Delivery options: platform courier, in-person meetup, seller-arranged with tracking reference.
- Courier assignment (manual by admin in the MVP), courier mobile view, pickup confirmation with photo, **4-digit delivery code** shown only to the buyer.
- Courier cash ledger + daily reconciliation report.

### Phase 6 — Trust, disputes, admin
- Ratings and reviews (only after a completed order).
- Seller trust level: phone verified → ID verified (optional, required above a sales threshold) → trusted seller badge.
- Dispute flow: the buyer opens it with a reason and photos, the seller responds, the admin decides (refund / partial / release). All actions are logged.
- Admin dashboard: users, listings queue, payments to verify, disputes, payouts, courier cash, fraud flags, audit log search.

### Phase 7 — Hardening & launch readiness
- Security review against the checklist below, load test, backup/restore drill, privacy policy + terms drafts (Arabic + English), seed data, demo script.

**Stop at the end of every phase.** Summarise what was built, show how to run it, list the tests, and wait for my go-ahead.

---

## 7. Security, privacy & anti-fraud (non-negotiable)

Target **OWASP ASVS Level 2**.

**Edge / network**
- Deploy behind **Cloudflare** (or equivalent) with WAF managed rules, bot protection, DDoS protection, and per-route rate limits.
- Only the edge can reach the app origin.
- Database and Redis are on a private network with **no public IP**.

**Application**
- **Auth:** OTP codes hashed and single-use, with a 5-minute TTL and attempt limits. Per-phone and per-IP rate limits. Sessions are httpOnly, Secure, SameSite=Lax. Rotate the session on login. Device list with "log out other devices".
- **Admin and finance:** mandatory TOTP 2FA, IP allow-list option, least-privilege RBAC, and every action written to an **append-only audit log**.
- **Validation:** every input is validated with schemas (e.g. Zod) at the edge of every API. Parameterised queries only.
- **Browser protections:** CSRF protection, strict **CSP**, HSTS, secure headers.
- **File uploads:** type sniffing (not the extension), size limits, re-encode images, strip metadata, store in private buckets, serve through signed URLs or a CDN. Malware-scan hook for non-image files.
- **Object-level authorisation checks** on every resource (no IDOR). Write tests that try to access other users' orders, chats, and addresses.
- **Idempotency keys** on all payment and order writes. Row-level locking or `SELECT … FOR UPDATE` around escrow transitions to prevent double-spend and double-sell.
- **Secrets** in environment/secret manager only. Never commit secrets. Add secret scanning in CI, plus dependency scanning (Dependabot / `npm audit`) and SAST (CodeQL).

**Data**
- **Privacy by design:**
  - phone numbers never shown publicly
  - exact address and map pin revealed only to the assigned courier and only for an active delivery, then hidden again
  - ID documents encrypted at rest (field-level), viewable only by the verification role, auto-deleted after verification per retention policy
- **Data minimisation and retention policy**, account deletion (right to erasure while keeping legally required financial records), and export of your own data.
- **Backups:** encrypted, daily, with a tested restore.
- **Logs:** no PII in logs (phone numbers masked).

**Anti-fraud**
- New-account limits: listing count, order value.
- Velocity checks.
- Duplicate-payment-reference detection.
- Device fingerprint hash.
- Flags for suspicious chat patterns (phone numbers or "pay me directly").
- Seller payout hold for brand-new sellers.
- Admin fraud queue.

---

## 8. Suggested tech stack (confirm or challenge it in Phase 0)

- **Web app:** Next.js (App Router) + TypeScript + Tailwind (RTL-aware) as a **PWA**, mobile-first. A native app can come later with the same API.
- **Backend:** Next.js route handlers or a separate Node (Fastify/NestJS) API. Pick one and justify the choice.
- **DB:** PostgreSQL + Prisma (or Drizzle). **Redis** for rate limits, queues (BullMQ), and OTP throttling.
- **Storage:** S3-compatible (Cloudflare R2 or Supabase Storage).
- **Realtime:** WebSocket (e.g. Socket.IO or Supabase Realtime) with polling fallback.
- **Testing:** Vitest (unit), Playwright (E2E, including an RTL visual check). The state machine and ledger need **100% transition/branch coverage**.
- **Everything must run inside GitHub Codespaces**: add `.devcontainer/devcontainer.json` and one command to start (`npm run dev` / `docker compose up`).

---

## 9. Definition of done (every phase)

- Typecheck, lint, and all tests pass in CI.
- Arabic RTL screens checked at 360px width.
- No secrets in the repo.
- README updated with how to run.
- A short `docs/decisions/NNN-*.md` note for each important decision.

## 10. Open questions to raise in Phase 0

- Does holding customer funds need a **Central Bank of Sudan** licence or a licensed partner bank/PSP? (Assume yes: design so a licensed partner can hold the escrow account.)
- Launch city (one city first is strongly recommended).
- Fee levels, inspection window length, seller hand-over deadline.
- Which courier partners are available at launch?
- Brand name and domain.
