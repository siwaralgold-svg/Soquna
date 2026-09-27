# 004 — Own phone + OTP auth with database sessions

Status: Accepted (Phase 0)

## Context

Most users have no email. Login is phone + SMS OTP through a Sudanese SMS gateway, with a WhatsApp fallback later. Hosted auth services support few SMS providers.

## Decision

- OTP codes are hashed, single-use, expire after 5 minutes, and have attempt limits. Rate limits apply per phone and per IP (Redis).
- Sessions are random tokens stored hashed in Postgres (not JWTs), so they can be revoked at once. They are rotated on login and listed per device, with "log out other devices".
- Phone numbers are stored encrypted, with an HMAC hash for lookup.
- Admin and finance roles need TOTP 2FA.
- SMS sending goes through a pluggable `SmsProvider` (mock in development).

## Consequences

- We own and test this code (auth tests are part of the IDOR/authorisation suite).
