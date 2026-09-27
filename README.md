# Souqna (سوقنا)

A peer-to-peer marketplace for Sudan, built for small, everyday sellers. The platform holds the buyer's money (escrow) until the item is delivered and confirmed.

**Status:** Phase 4 (Checkout, escrow & ledger) built and waiting for review. Plan: [`docs/plan/phase-0.md`](docs/plan/phase-0.md).

What works today:

- Log in with a Sudanese mobile number and a 6-digit SMS code (a fake SMS provider in development).
- Complete a profile: display name, city, optional neighbourhood, profile photo.
- See the devices you're logged in on, log one out, or log out all the others.
- **Sell:** post a listing with up to 8 photos (shrunk on the phone, location data removed), category, condition, price and city. The form is saved on the phone, so a lost connection or a closed tab doesn't lose work; photos taken offline upload when the signal comes back.
- **Find:** home feed, category chips, and search in Arabic or English that copes with spelling variants (أ/إ/آ, ة/ه, ى/ي, diacritics, "ال"). Filter by city, category, price and condition; sort by newest or price.
- **Trust:** save favourites, report a listing, safety tips on every listing. Phone numbers and links are not allowed in listings. Prohibited items are blocked or sent to a moderator.
- **Chat:** tap **Chat with seller** on a listing for a private 1:1 chat about that item. Messages arrive live (WebSocket, falling back to ordinary requests on poor networks), photos can be sent, and a red badge on **Chats** in the bottom bar shows unread messages. A message written with no signal waits on the phone and sends by itself when the connection is back.
- **Offers:** on a negotiable listing the buyer can tap **Make an offer**; the seller taps **Accept** or **Decline**, and the buyer can withdraw it. An offer expires after 48 hours, and only one can be waiting at a time. Once accepted, the buyer taps **Buy at this price**.
- **Anti-fraud in chat:** phone numbers and links are replaced with `•••` before anyone sees them, and messages that suggest paying outside the app (Bankak, cash, WhatsApp…) show a warning to both people and are flagged for the fraud team. Safety tips stay at the top of every chat.
- **Buy safely (escrow):** **Buy safely** on a listing opens checkout with a clear breakdown: item price + delivery fee + buyer-protection fee. Choose a Souqna courier or an in-person meetup, and pay by **Bankak/bank transfer** (buyer sends the transaction number, plus an optional screenshot), **cash on delivery** (only after a first completed order, below a limit), or a **test payment** in development. The listing is reserved at once, so it can't be sold twice.
- **Order page** for buyer and seller: status in plain words, deadlines, what to do next, the money breakdown, and a timeline of who did what and when. It updates live. The seller sees "Paid, money held safely" and taps **The item is ready**. Either side can cancel before hand-over (full refund); unpaid orders cancel themselves after 24 hours, and a seller who doesn't hand over within 3 days loses the order (refund).
- **Finance screen** at `/admin/payments`: check each bank transfer against the statement and **verify** or **reject** it (the buyer sees the reason and can try again). Needs a finance/admin role and a code from an authenticator app (2FA). The same transaction number can never be used twice.
- **Money is tracked in a double-entry ledger**; the database refuses any money movement that doesn't balance. After confirmation (or automatically when the inspection window ends) the seller's earnings appear under **Your balance** on the account page; new sellers' first 3 sales are held for 7 days. (Delivery with couriers and the 4-digit code come in Phase 5; withdrawals and disputes in Phase 6.)
- Once an order is paid, phone numbers are no longer hidden in that buyer's chat with the seller, so they can arrange the hand-over.
- Arabic (right-to-left) by default, English at `/en`. Installable as an app (PWA), with an offline page.

---

## Run it in GitHub Codespaces (no install on your laptop)

Everything runs in the browser. You only need a GitHub account.

1. On this repository's page on GitHub, click the green **`<> Code`** button.
2. Open the **Codespaces** tab.
3. Click **`...`** (three dots) → **New with options…**
   - **Branch:** pick the branch you want to try (for example `main`, or the branch of an open pull request).
   - **Machine type:** choose **4-core**. The project asks for 4 cores; 2 cores is too slow.
   - Click **Create codespace**.
4. Wait a few minutes. The first start installs everything and prepares the database. In the terminal at the bottom you'll see `Ready. Start the app with: pnpm dev` when it's done.
5. In that terminal, type:

   ```
   pnpm dev
   ```

6. A pop-up says _"Your application running on port 3000 is available"_. Click **Open in Browser**. (If you miss it: open the **Ports** tab next to **Terminal**, find port **3000**, and click the globe icon.)

### Logging in during development

No real SMS is sent. After you enter a phone number (e.g. `0912345678`), the code appears:

- on the login screen itself, in a small yellow **DEV** box, and
- in the terminal, on a line that says `mock SMS sent`.

### Trying the chat with two people

You need two accounts logged in at once. Open the app in a normal window and log in as the seller (post a listing), then open a **private/incognito window** (in Chrome: **⋮** menu → **New Incognito window**), paste the same address, and log in with a different phone number as the buyer. Open the listing and tap **كلّم البائع** (_Chat with seller_).

### Seeing it like a phone

In the browser tab with the app, press **F12** (or right-click → **Inspect**), then click the phone/tablet icon (**Toggle device toolbar**) and pick a small Android screen, or type width **360**.

### Stopping the codespace

Codespaces stop by themselves after 30 minutes without activity. To stop one straight away: go to [github.com/codespaces](https://github.com/codespaces), click **`...`** next to it → **Stop codespace**. Stopped codespaces don't use your monthly hours.

---

## Everyday commands

Run these in the Codespace terminal:

| Command                           | What it does                                                          |
| --------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev`                        | Start the web app (port 3000) and API (port 4000), reloading on save. |
| `pnpm test`                       | Unit tests and API tests (login, sessions, profile, IDOR checks).     |
| `pnpm build`                      | Production build of the API and web app.                              |
| `pnpm e2e`                        | Browser tests at 360px in Arabic. Run `pnpm build` first.             |
| `pnpm lint`                       | Code style and safety rules (incl. "no hard-coded text").             |
| `pnpm typecheck`                  | TypeScript checks.                                                    |
| `pnpm format`                     | Auto-format all files.                                                |
| `pnpm db:migrate`                 | Apply database migrations.                                            |
| `pnpm db:seed`                    | Add/update the starting list of cities.                               |
| `pnpm db:generate`                | Create a migration after changing `packages/db/src/schema.ts`.        |
| `pnpm --filter @souqna/web icons` | Regenerate app icons from `apps/web/scripts/icon.svg`.                |
| `pnpm moderate list`              | Show listings waiting for a moderator (see below).                    |
| `pnpm staff list`                 | Show who has a staff role (finance, admin…). See below.               |

Browser-test screenshots are saved under `apps/web/test-results/`. In CI they're attached to each run as the **playwright-report** artifact (open the run in the **Actions** tab → scroll to **Artifacts**).

---

## Moderating listings (until the admin screens arrive)

Listings that mention a "review" keyword (e.g. medicines, animals), or that get reports from 3 different people, are hidden until someone checks them. The admin screens with two-factor login come in Phase 6; until then, moderate from the Codespace terminal:

```
pnpm moderate list
pnpm moderate approve <listing-id>
pnpm moderate reject <listing-id> "reason the seller will see"
pnpm moderate remove <listing-id> "reason the seller will see"
```

Every decision is written to the audit log. The keyword list and categories live in `packages/db/src/seed-data.ts`; after editing, run `pnpm db:seed`.

## Checking payments (finance)

Staff roles are given from the Codespace terminal, never from the web app. The person must have logged in to the app once with their phone number.

1. In the terminal, run `pnpm staff grant 0912345678 finance` (their number, and the role `finance` or `admin`).
2. The first time, it prints a **Key**. On their phone, open an authenticator app (Google Authenticator or Microsoft Authenticator), tap **+** → **Enter a setup key**, type any account name, paste the key, and choose **Time based**. Share the key privately; it's shown only once.
3. They open `/admin/payments` in the app (for example `https://<your-codespace>-3000.app.github.dev/ar/admin/payments`), type the 6-digit code from the app, and tap **تحقّق** (_Verify_). The code is asked again every 12 hours.

Other commands: `pnpm staff revoke 0912345678 finance`, `pnpm staff reset-2fa 0912345678` (lost phone). In development, `pnpm staff code 0912345678` prints the current code so you can test without a phone.

### Trying a purchase in development

`.env` has `PAYMENT_MOCK_ENABLED=true`, which adds a **Test payment** option that pays instantly. (If your `.env` was created before Phase 4, add these lines to it: `PAYMENT_MOCK_ENABLED=true`, `PAYMENT_ACCOUNT_NAME=Souqna TEST`, `PAYMENT_ACCOUNT_NUMBER=0000-TEST`.) Production refuses to start with test payments on, or without a real `PAYMENT_ACCOUNT_NUMBER`.

Fees, limits and timers are placeholders until you decide them (open questions 2, 5, 8 and 12 in the plan): buyer protection 1,000 SDG + 5 % (at most 25,000 SDG), courier 5,000 SDG, pay within 24 h, hand over within 3 days, 48 h to check the item. They live in the `order_configs` table; see [decision 010](docs/decisions/010-orders-escrow-ledger.md).

## Project layout

```
apps/
  api/        Fastify API: login, listings, chat, orders, payments,  (port 4000)
              ledger, staff 2FA, Socket.IO, order timers
  web/        Next.js app (PWA), Arabic-first                        (port 3000)
packages/
  domain/     Pure business rules: order/listing/offer state machines, fees,
              ledger postings, money, masking (100 % test coverage)
  contracts/  Request/response schemas shared by web and API
  db/         Database schema, migrations, seed data
  i18n/       All user-facing text: messages/ar.json and messages/en.json
docs/
  plan/       Phase plans
  decisions/  Short notes on important decisions
```

The browser only ever calls `/api/...` on the same address as the web app; Next.js forwards those calls to the API. See [decision 005](docs/decisions/005-sessions-csrf-csp.md).

## Configuration and secrets

- `.env.example` lists every setting, with placeholders only. `pnpm setup` (run automatically in Codespaces) copies it to `.env` and fills in random development secrets. `.env` is never committed.
- Production secrets will live in the hosting provider's secret manager (Phase 7).

## Recommended GitHub settings

In the repository, go to **Settings** → **Advanced Security** (called **Code security** on some accounts) and turn on **Dependabot alerts**, **Secret Protection** / **Secret scanning**, and **Push protection**. CI also runs its own secret scan, dependency audit and CodeQL.

## Files

- `PROMPT.md`: the full product and engineering brief
- `CLAUDE.md`: working rules Claude Code follows automatically in this repo
- `docs/plan/`: phase plans
- `docs/decisions/`: short notes on important decisions
