# 006 — Arabic-first UI, system fonts, 200 KB JS budget

Status: Accepted (Phase 1)

## Context

Users are mostly on cheap Android phones with slow, expensive, often-interrupted networks. Arabic is the main language.

## Decision

- **i18n:** next-intl. Arabic at `/`, English at `/en`. All text lives in `packages/i18n/messages/*.json`, shared with the API (SMS text). A lint rule rejects hard-coded text in JSX and in `alt`/`title`/`placeholder`/`aria-label`. A test checks that both languages have the same keys and placeholders.
- **RTL:** `<html dir="rtl">` for Arabic. Layout uses logical Tailwind utilities (`ms-*`, `text-start`) so the same markup works both ways. Phone numbers and codes are shown left-to-right inside Arabic text using Unicode isolates or `<bdi dir="ltr">`.
- **Input:** phone numbers and codes accept Arabic-Indic digits (٠-٩, ۰-۹).
- **Fonts:** system fonts only (no web-font download). Android ships Noto Arabic fonts.
- **JS budget:** a Playwright test fails the build if the home page loads more than 200 KB of compressed JavaScript. It is 147 KB today. Browser code must not import zod (≈90 KB): values come from `@souqna/contracts/constants`, and a lint rule enforces this.
- **Images:** photos are shrunk in the browser before upload (WebP, max 1024 px), then re-encoded on the server.
- **PWA:** web manifest plus a small hand-written service worker. It shows an offline page when there is no connection and caches hashed build files. It never caches API responses.
- **Design tokens:** colours, radii and fonts are defined once in `apps/web/src/app/globals.css` (`@theme`).

## Consequences

- Arabic copy should be reviewed by a Sudanese speaker before launch (open question 19).
- Adding a big client-side library will trip the budget test, on purpose.
