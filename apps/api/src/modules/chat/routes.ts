import {
  messagesQuery,
  offerActionInput,
  sendMessageInput,
  startConversationInput,
} from '@souqna/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { IMAGE_UPLOAD_MAX_BYTES } from '../../lib/images';
import { idempotency } from '../../plugins/idempotency';
import { requireAuth } from '../auth/session';
import { storePhoto } from '../listings/photos';
import {
  actOnOffer,
  conversationFor,
  listConversations,
  listMessages,
  markRead,
  sendMessage,
  startConversation,
  unreadTotal,
} from './service';

const idParams = z.object({ id: z.uuid() });
const offerParams = z.object({ id: z.uuid(), offerId: z.uuid() });

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  const idem = idempotency(app);

  app.post('/conversations', async (request, reply) => {
    const { userId } = requireAuth(request);
    const { listingId } = startConversationInput.parse(request.body);
    const id = await startConversation(ctx, userId, listingId);
    return reply.status(201).send({ id });
  });

  app.get('/conversations', async (request) => listConversations(ctx, requireAuth(request).userId));

  // Polled by the bottom navigation on every page, so it answers visitors too (no 401 noise).
  app.get('/conversations/unread', async (request) =>
    request.auth
      ? { signedIn: true, count: await unreadTotal(ctx, request.auth.userId) }
      : { signedIn: false, count: 0 },
  );

  app.get('/conversations/:id', async (request) => {
    const { userId } = requireAuth(request);
    const { id } = idParams.parse(request.params);
    const [summary] = await listConversations(ctx, userId, id);
    // A buyer's empty conversation is included; a seller only sees it after the first message.
    if (!summary) throw new AppError('not_found');
    return summary;
  });

  app.get('/conversations/:id/messages', async (request) => {
    const { userId } = requireAuth(request);
    const { id } = idParams.parse(request.params);
    const conv = await conversationFor(ctx, id, userId);
    return listMessages(ctx, conv.id, messagesQuery.parse(request.query));
  });

  app.post(
    '/conversations/:id/messages',
    {
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      preHandler: idem.preHandler,
      onSend: idem.onSend,
    },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      const { id } = idParams.parse(request.params);
      const conv = await conversationFor(ctx, id, userId);
      const input = sendMessageInput.parse(request.body);
      return reply.status(201).send(await sendMessage(ctx, conv, userId, input));
    },
  );

  app.post('/conversations/:id/offers/:offerId/actions', async (request) => {
    const { userId } = requireAuth(request);
    const { id, offerId } = offerParams.parse(request.params);
    const conv = await conversationFor(ctx, id, userId);
    const { action } = offerActionInput.parse(request.body);
    return actOnOffer(ctx, conv, offerId, action);
  });

  app.post('/conversations/:id/read', async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = idParams.parse(request.params);
    await markRead(ctx, await conversationFor(ctx, id, userId));
    return reply.status(204).send();
  });

  app.post(
    '/chat-photos',
    { config: { rateLimit: { max: 60, timeWindow: 60 * 60 * 1000 } } },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      const file = await request.file({
        limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES, files: 1, fields: 0 },
      });
      if (!file) throw new AppError('upload_invalid');
      return reply
        .status(201)
        .send(await storePhoto(ctx, userId, 'chat_photo', await file.toBuffer()));
    },
  );
}
