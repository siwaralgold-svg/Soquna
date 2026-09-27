import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@souqna/contracts';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Requests per minute from one IP address, across the whole API. */
export const GLOBAL_IP_LIMIT_PER_MINUTE = 300;

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  // The API only returns JSON and images, so it can use the strictest possible CSP.
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });

  // Baseline limit for every route. Sensitive routes (OTP) add stricter limits of their own.
  await app.register(rateLimit, {
    global: true,
    max: GLOBAL_IP_LIMIT_PER_MINUTE,
    timeWindow: 60_000,
    redis: app.ctx.redis,
    nameSpace: 'rl:ip:global:',
    // Keys hold a hash of the IP, never the IP itself.
    keyGenerator: (request) => app.ctx.hashIp(request.ip).toString('hex'),
    errorResponseBuilder: (_request, context) =>
      new AppError('rate_limited', { retryAfterSeconds: Math.ceil(context.ttl / 1000) }),
  });

  const allowedOrigins = new Set(app.ctx.config.APP_ORIGIN);

  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    // Server-to-server webhooks carry no cookies and prove themselves with a signature.
    if ((request.routeOptions.config as { signedWebhook?: boolean }).signedWebhook) return;

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
