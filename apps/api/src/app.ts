import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { createContext, type AppDeps } from './context';
import { authRoutes } from './modules/auth/routes';
import { registerSessionHook } from './modules/auth/session';
import { catalogRoutes } from './modules/catalog/routes';
import { chatRoutes } from './modules/chat/routes';
import { devRoutes } from './modules/dev/routes';
import { listingRoutes } from './modules/listings/routes';
import { profileRoutes } from './modules/profile/routes';
import { registerErrorHandling } from './plugins/errors';
import { registerSecurity } from './plugins/security';
import { registerRealtime } from './realtime';

export interface BuildAppOptions {
  /** Custom pino destination, used by tests to check that logs contain no PII. */
  logStream?: NodeJS.WritableStream;
}

export async function buildApp(
  deps: AppDeps,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: deps.config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
    logger: {
      level: deps.config.LOG_LEVEL,
      stream: options.logStream,
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'res.headers["set-cookie"]',
          '*.phone',
          '*.code',
        ],
        censor: '[redacted]',
      },
      // Log method + path only: no query strings, IPs or headers (they can carry PII).
      serializers: {
        req: (req: { method: string; url: string; id: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
      },
    },
  });

  app.decorate('ctx', createContext(deps));

  registerErrorHandling(app);
  await app.register(cookie);
  await app.register(multipart);
  await registerSecurity(app);
  registerSessionHook(app);

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }));
      await api.register(authRoutes);
      await api.register(profileRoutes);
      await api.register(catalogRoutes);
      await api.register(listingRoutes);
      await api.register(chatRoutes);
      if (deps.config.NODE_ENV !== 'production') await api.register(devRoutes);
    },
    { prefix: '/api' },
  );
  registerRealtime(app);

  return app;
}
