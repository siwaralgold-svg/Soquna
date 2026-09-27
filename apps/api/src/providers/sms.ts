import { maskPhone } from '@souqna/domain';

interface InfoLogger {
  info(obj: object, msg: string): void;
}

export interface SmsMessage {
  /** E.164 number. Never log this directly; use maskPhone(). */
  to: string;
  text: string;
  /** Present for OTP messages so the mock provider can expose it in development. */
  otpCode?: string;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<void>;
}

/**
 * Development/test provider. Keeps the last code per number in memory so the dev-only
 * endpoint and tests can read it; prints the code (with the number masked) to the terminal.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  private readonly outbox = new Map<string, SmsMessage>();

  constructor(private readonly log?: InfoLogger) {}

  async send(message: SmsMessage): Promise<void> {
    this.outbox.set(message.to, message);
    this.log?.info({ to: maskPhone(message.to), otp: message.otpCode }, 'mock SMS sent');
  }

  lastCodeFor(phone: string): string | undefined {
    return this.outbox.get(phone)?.otpCode;
  }
}

/**
 * Placeholder for the WhatsApp OTP fallback. Needs a WhatsApp Business account and an
 * approved authentication template before it can be implemented (see Phase 0 open questions).
 */
export class WhatsAppOtpProvider implements SmsProvider {
  readonly name = 'whatsapp';

  async send(): Promise<void> {
    throw new Error('WhatsApp OTP provider is not configured yet');
  }
}
