import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors';
import { verifyPspSignature } from './providers';

/**
 * Stub for a future licensed payment gateway (PSP). The route only exists when a signing
 * secret is configured. Today it checks the signature and acknowledges the event; turning
 * a verified event into `verify_payment` comes with the real gateway and its payment method.
 */
export async function paymentWebhookRoutes(app: FastifyInstance): Promise<void> {
  const secret = app.ctx.config.PSP_WEBHOOK_SECRET;
  if (!secret) return;

  // The signature covers the exact bytes sent, so keep the raw body (this plugin only).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  app.post(
    '/payments/psp/webhook',
    { config: { signedWebhook: true, rateLimit: { max: 120, timeWindow: 60_000 } } },
    async (request, reply) => {
      const raw = request.body as Buffer;
      const ok = verifyPspSignature(
        secret,
        raw,
        request.headers['x-psp-timestamp'] as string | undefined,
        request.headers['x-psp-signature'] as string | undefined,
      );
      if (!ok) throw new AppError('forbidden');
      let event: unknown;
      try {
        event = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new AppError('validation_failed');
      }
      request.log.info({ pspEvent: (event as { type?: string }).type }, 'psp webhook received');
      return reply.status(202).send({ received: true });
    },
  );
}
