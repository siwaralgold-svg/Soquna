# 011 — Payment providers and staff two-step verification

Status: Accepted (Phase 4)

## Payment providers

A small `PaymentProvider` interface (`apps/api/src/modules/payments/providers.ts`): does the buyer submit a payment, does it confirm by itself, what instructions to show, and how to read the reference the buyer typed.

- **ManualBankTransferProvider (MVP).** The buyer transfers the exact total to the platform account (from settings; ideally a licensed partner bank's escrow account) with the order code in the note. They then submit the transaction number and, optionally, a screenshot. Finance checks the bank statement and verifies (→ `funds_held`, ledger L1) or rejects with a reason (the buyer can resubmit, 3 attempts per order).
  - References are normalised (Arabic digits, case, spaces, dashes) and unique across all claims that weren't rejected, enforced by a DB index. A reused reference is refused and recorded as a fraud flag.
- **CashOnDeliveryEscrowProvider.** Nothing is paid in the app. The seller confirms the order and the courier collects the cash at the door, recorded in `courier_cash:{courier}` as part of the delivery transition (Phase 5 adds the courier screens and daily reconciliation).
- **MockProvider.** Development and tests only: "pays" instantly through the same verify transition, as the system actor. Production refuses to start with `PAYMENT_MOCK_ENABLED=true`.
- **Licensed gateway stub.** `POST /api/payments/psp/webhook` exists only when `PSP_WEBHOOK_SECRET` is set. It checks an HMAC-SHA256 signature over `timestamp.body` (exact raw bytes) and refuses timestamps older than 5 minutes. It is exempt from the browser CSRF check because the signature replaces it. Today it only acknowledges; wiring a verified event to `verify_payment` comes with the real gateway.

## Payment screenshots

Stored like other photos (re-encoded, metadata stripped), as `payment_proof` media. Only the buyer who uploaded one and finance/admin staff with a fresh 2FA code can see it.

## Staff roles and 2FA

- Roles (`finance`, `admin`, `moderator`, …) are granted only with the `pnpm staff` command, which needs server access. Every grant, revoke and 2FA reset is audited.
- 2FA is TOTP (RFC 6238, the standard authenticator-app codes), implemented with `node:crypto` and tested against the RFC's test vectors. Secrets are stored encrypted (AES-256-GCM, like phone numbers). Each code works only once (the last used time step is stored), and a session gets at most 5 tries per 15 minutes.
- A staff route needs the role **and** a 2FA code entered on this session within the last 12 hours. People without a staff role get 404, so staff routes aren't advertised.
- Verify/reject decisions are written to the audit log together with the order event.

## Consequences

- Finance must check each transfer by hand until a licensed gateway exists, so the order page tells buyers to expect "a few hours, 9am–9pm".
- The admin dashboard for everything else (moderation, disputes, payouts, fraud queue) arrives in Phase 6, on top of the same roles and 2FA.
