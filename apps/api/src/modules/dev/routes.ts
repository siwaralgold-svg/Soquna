import { phoneSchema } from '@souqna/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { MockSmsProvider } from '../../providers/sms';

/**
 * Development-only helper so you can log in without a real SMS. Registered only when
 * NODE_ENV is not production AND the mock SMS provider is in use (see app.ts).
 */
export async function devRoutes(app: FastifyInstance): Promise<void> {
  const sms = app.ctx.sms;
  if (!(sms instanceof MockSmsProvider)) return;

  app.get('/dev/otp', async (request) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(request.query);
    const code = sms.lastCodeFor(phone);
    if (!code) throw new AppError('not_found');
    return { code };
  });
}
