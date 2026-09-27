import { createHmac, randomBytes } from 'node:crypto';
import { normalizePaymentReference, type PaymentMethod } from '@souqna/domain';
import type { Config } from '../../config';
import { safeEqual } from '../../lib/crypto';
import { AppError } from '../../lib/errors';

export interface PaymentInstructions {
  bankName: string;
  accountName: string;
  accountNumber: string;
  amountMinor: bigint;
  /** Written in the transfer note so finance can match it: the order code. */
  note: string;
}

/**
 * A way of paying (PROMPT.md §3.1). Adding a licensed gateway later means adding one
 * adapter here plus its signed webhook; the order state machine doesn't change.
 */
export interface PaymentProvider {
  readonly method: PaymentMethod;
  /** Payments are submitted by the buyer (bank transfer, mock) rather than collected in person. */
  readonly prepaid: boolean;
  /** Confirms by itself, with no finance review (mock; a gateway via its webhook). */
  readonly confirmsInstantly: boolean;
  instructions(order: { publicCode: string; totalMinor: bigint }): PaymentInstructions | null;
  /** Turns what the buyer typed into the reference we store, or refuses it. */
  reference(input: string | undefined): string;
}

/** MVP: the buyer transfers to our Bankak/bank account and sends the transaction reference. */
export class ManualBankTransferProvider implements PaymentProvider {
  readonly method = 'bank_transfer';
  readonly prepaid = true;
  readonly confirmsInstantly = false;

  constructor(private readonly config: Config) {}

  instructions(order: { publicCode: string; totalMinor: bigint }): PaymentInstructions {
    return {
      bankName: this.config.PAYMENT_BANK_NAME,
      accountName: this.config.PAYMENT_ACCOUNT_NAME,
      accountNumber: this.config.PAYMENT_ACCOUNT_NUMBER,
      amountMinor: order.totalMinor,
      note: order.publicCode,
    };
  }

  reference(input: string | undefined): string {
    const ref = input ? normalizePaymentReference(input) : null;
    if (!ref)
      throw new AppError('validation_failed', { fields: { reference: 'invalid_reference' } });
    return ref;
  }
}

/**
 * Cash on delivery: the courier collects the total at the door before handing the item
 * over, and the cash counts as held (courier_cash ledger) until it's handed in (Phase 5).
 * Nothing is submitted in the app.
 */
export class CashOnDeliveryEscrowProvider implements PaymentProvider {
  readonly method = 'cod';
  readonly prepaid = false;
  readonly confirmsInstantly = false;

  instructions(): null {
    return null;
  }

  reference(): string {
    throw new AppError('conflict');
  }
}

/** Development and tests: "pays" instantly. Refused in production by the config check. */
export class MockProvider implements PaymentProvider {
  readonly method = 'mock';
  readonly prepaid = true;
  readonly confirmsInstantly = true;

  instructions(): null {
    return null;
  }

  reference(): string {
    return `MOCK${randomBytes(8).toString('hex').toUpperCase()}`;
  }
}

export function paymentProviders(config: Config): Record<PaymentMethod, PaymentProvider> {
  return {
    bank_transfer: new ManualBankTransferProvider(config),
    cod: new CashOnDeliveryEscrowProvider(),
    mock: new MockProvider(),
  };
}

/** Payment methods a buyer may choose in this environment. */
export function enabledPaymentMethods(config: Config): PaymentMethod[] {
  return config.PAYMENT_MOCK_ENABLED ? ['bank_transfer', 'cod', 'mock'] : ['bank_transfer', 'cod'];
}

/** How old a gateway webhook may be before we refuse it (replay protection). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Stub for a future licensed gateway: checks `X-PSP-Signature: sha256=<hex>` over
 * `${timestamp}.${rawBody}` with the shared secret, and that the timestamp is recent.
 */
export function verifyPspSignature(
  secret: string,
  rawBody: Buffer,
  timestamp: string | undefined,
  signature: string | undefined,
  now = Date.now(),
): boolean {
  if (!secret || !timestamp || !signature?.startsWith('sha256=')) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(now / 1000 - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const given = Buffer.from(signature.slice('sha256='.length), 'hex');
  return safeEqual(expected, given);
}
