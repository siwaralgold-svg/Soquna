import { rejectPaymentInput, staffMfaInput } from '@souqna/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idempotency } from '../../plugins/idempotency';
import { listStaffPayments, rejectPayment, verifyPayment } from '../payments/service';
import { requireStaff, staffMe, verifyStaffCode } from './mfa';

const paymentParams = z.object({ id: z.uuid() });
const paymentsQuery = z.object({
  status: z.enum(['submitted', 'verified', 'rejected']).default('submitted'),
});
const FINANCE = ['finance', 'admin'] as const;

/** Back-office routes. Every one needs a staff role and a fresh 2FA code on the session. */
export async function staffRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  const idem = idempotency(app);

  app.get('/staff/me', async (request) => staffMe(ctx, request));

  app.post(
    '/staff/mfa',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const { code } = staffMfaInput.parse(request.body);
      await verifyStaffCode(ctx, request, code);
      return reply.status(204).send();
    },
  );

  app.get('/staff/payments', async (request) => {
    await requireStaff(ctx, request, FINANCE);
    const { status } = paymentsQuery.parse(request.query);
    return listStaffPayments(ctx, status);
  });

  app.post(
    '/staff/payments/:id/verify',
    { preHandler: idem.preHandler, onSend: idem.onSend },
    async (request, reply) => {
      const { userId } = await requireStaff(ctx, request, FINANCE);
      const { id } = paymentParams.parse(request.params);
      await verifyPayment(ctx, userId, id, request.ip);
      return reply.status(204).send();
    },
  );

  app.post(
    '/staff/payments/:id/reject',
    { preHandler: idem.preHandler, onSend: idem.onSend },
    async (request, reply) => {
      const { userId } = await requireStaff(ctx, request, FINANCE);
      const { id } = paymentParams.parse(request.params);
      const { reason } = rejectPaymentInput.parse(request.body);
      await rejectPayment(ctx, userId, id, reason, request.ip);
      return reply.status(204).send();
    },
  );
}
