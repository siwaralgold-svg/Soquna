import helmet from '@fastify/helmet';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@souqna/contracts';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const GLOBAL_IP_LIMIT = { name: 'ip:global', max: 300, windowSeconds: 60 };

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  // The API only returns JSON and images, so it can use the strictest possible CSP.
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });

  const allowedOrigins = new Set(app.ctx.config.APP_ORIGIN);

  app.addHook('onRequest', async (request) => {
    await app.ctx.limiter.consume(app.ctx.hashIp(request.ip).toString('hex'), [GLOBAL_IP_LIMIT]);

    if (SAFE_METHODS.has(request.method)) return;

    // CSRF: a custom header can't be sent cross-site without a CORS preflight, and we never
    // enable CORS. The origin check is a second layer.
    if (request.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) throw new AppError('csrf_failed');
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (!allowedOrigins.has(origin)) throw new AppError('csrf_failed');
    } else if (
      request.headers['sec-fetch-site'] &&
      request.headers['sec-fetch-site'] !== 'same-origin'
    ) {
      throw new AppError('csrf_failed');
    }
  });
}
