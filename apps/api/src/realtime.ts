import { REALTIME_PATH } from '@souqna/contracts';
import { createAdapter } from '@socket.io/redis-adapter';
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { SESSION_COOKIE, resolveSession } from './modules/auth/session';

/**
 * Socket.IO for pushing chat events. It only ever *pushes*: clients send messages over the
 * normal HTTP API (idempotent, validated, rate-limited). Socket.IO falls back to HTTP
 * long-polling on its own when WebSockets are blocked. A Redis adapter lets several API
 * instances share connections.
 */
export function registerRealtime(app: FastifyInstance): void {
  const allowedOrigins = new Set(app.ctx.config.APP_ORIGIN);
  const io = new Server(app.server, {
    path: REALTIME_PATH,
    // Next.js (which proxies /api to us) redirects URLs ending in "/", so use none.
    addTrailingSlash: false,
    serveClient: false,
    // Cookies travel with the handshake, so refuse other sites (cross-site WebSocket hijacking).
    // Browsers always send Origin on WebSocket and cross-site requests; they leave it out on
    // same-origin GETs (the long-polling fallback), where Sec-Fetch-Site says "same-origin".
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      const allowed =
        origin !== undefined
          ? allowedOrigins.has(origin)
          : site === undefined || site === 'same-origin';
      callback(null, allowed);
    },
  });

  const pub = app.ctx.redis.duplicate();
  const sub = app.ctx.redis.duplicate();
  io.adapter(createAdapter(pub, sub));

  io.use(async (socket, next) => {
    const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '');
    const token = cookies[SESSION_COOKIE];
    const auth = token ? await resolveSession(app.ctx, token) : null;
    if (!auth) return next(new Error('unauthenticated'));
    socket.data.userId = auth.userId;
    socket.data.sessionId = auth.sessionId;
    next();
  });

  io.on('connection', (socket) => {
    void socket.join([
      `user:${socket.data.userId as string}`,
      `session:${socket.data.sessionId as string}`,
    ]);
  });

  app.ctx.realtime = {
    toUsers(userIds, event, payload) {
      io.to(userIds.map((id) => `user:${id}`)).emit(event, payload);
    },
    endSessions(sessionIds) {
      if (sessionIds.length === 0) return;
      io.in(sessionIds.map((id) => `session:${id}`)).disconnectSockets(true);
    },
  };

  app.addHook('onClose', async () => {
    await io.close();
    pub.disconnect();
    sub.disconnect();
  });
}
