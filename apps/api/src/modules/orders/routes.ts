import {
  checkoutQuery,
  createOrderInput,
  orderActionInput,
  ordersQuery,
  submitPaymentInput,
} from '@souqna/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { IMAGE_UPLOAD_MAX_BYTES } from '../../lib/images';
import { idempotency } from '../../plugins/idempotency';
import { requireAuth } from '../auth/session';
import { storePhoto } from '../listings/photos';
import { submitPayment } from '../payments/service';
import {
  balanceFor,
  checkoutQuote,
  createOrder,
  listOrders,
  orderAction,
  orderDetail,
} from './service';

const idParams = z.object({ id: z.uuid() });

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  const idem = idempotency(app);
  const idemRoute = { preHandler: idem.preHandler, onSend: idem.onSend };

  app.get('/checkout/quote', async (request) =>
    checkoutQuote(ctx, requireAuth(request).userId, checkoutQuery.parse(request.query)),
  );

  app.post(
    '/orders',
    { ...idemRoute, config: { rateLimit: { max: 20, timeWindow: 60 * 60 * 1000 } } },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      const id = await createOrder(ctx, userId, createOrderInput.parse(request.body));
      return reply.status(201).send({ id });
    },
  );

  app.get('/orders', async (request) =>
    listOrders(ctx, requireAuth(request).userId, ordersQuery.parse(request.query).role),
  );

  app.get('/orders/:id', async (request) => {
    const { userId } = requireAuth(request);
    return orderDetail(ctx, userId, idParams.parse(request.params).id);
  });

  app.post('/orders/:id/actions', idemRoute, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = idParams.parse(request.params);
    await orderAction(
      ctx,
      userId,
      id,
      orderActionInput.parse(request.body),
      request.idempotency!.key,
    );
    return orderDetail(ctx, userId, id);
  });

  app.post(
    '/orders/:id/payments',
    { ...idemRoute, config: { rateLimit: { max: 10, timeWindow: 60 * 60 * 1000 } } },
    async (request) => {
      const { userId } = requireAuth(request);
      const { id } = idParams.parse(request.params);
      const input = submitPaymentInput.parse(request.body);
      await submitPayment(ctx, userId, id, input, request.idempotency!.key);
      return orderDetail(ctx, userId, id);
    },
  );

  /** Screenshot of a bank transfer. Private: only the buyer and finance can see it. */
  app.post(
    '/payment-proofs',
    { config: { rateLimit: { max: 20, timeWindow: 60 * 60 * 1000 } } },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      const file = await request.file({
        limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES, files: 1, fields: 0 },
      });
      if (!file) throw new AppError('upload_invalid');
      return reply
        .status(201)
        .send(await storePhoto(ctx, userId, 'payment_proof', await file.toBuffer()));
    },
  );

  app.get('/me/balance', async (request) => balanceFor(ctx, requireAuth(request).userId));
}
