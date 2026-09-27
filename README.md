# Souqna (سوقنا)

A peer-to-peer marketplace for Sudan, built for small, everyday sellers. The platform holds the buyer's money (escrow) until the item is delivered and confirmed.

**Status:** Phase 2 (Listings) built and waiting for review. Plan: [`docs/plan/phase-0.md`](docs/plan/phase-0.md).

What works today:

- Log in with a Sudanese mobile number and a 6-digit SMS code (a fake SMS provider in development).
- Complete a profile: display name, city, optional neighbourhood, profile photo.
- See the devices you're logged in on, log one out, or log out all the others.
- **Sell:** post a listing with up to 8 photos (shrunk on the phone, location data removed), category, condition, price and city. The form is saved on the phone, so a lost connection or a closed tab doesn't lose work; photos taken offline upload when the signal comes back.
- **Find:** home feed, category chips, and search in Arabic or English that copes with spelling variants (أ/إ/آ, ة/ه, ى/ي, diacritics, "ال"). Filter by city, category, price and condition; sort by newest or price.
- **Trust:** save favourites, report a listing, safety tips on every listing. Phone numbers and links are not allowed in listings. Prohibited items are blocked or sent to a moderator.
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

## Project layout

```
apps/
  api/        Fastify API: login, sessions, profile, cities, media   (port 4000)
  web/        Next.js app (PWA), Arabic-first                        (port 3000)
packages/
  domain/     Pure business rules (phone numbers, display names)
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
