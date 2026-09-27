import type { ChatMessage } from '@souqna/contracts';
import { REALTIME_EVENTS, REALTIME_PATH } from '@souqna/contracts/constants';
import type { Socket } from 'socket.io-client';

type Handler = (message: ChatMessage) => void;
type Event = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

/**
 * One shared Socket.IO connection per tab, opened lazily by whichever screen needs it first.
 * The client library is only downloaded then, so it never counts toward a page's first load.
 * It only receives: messages are always sent over the normal HTTP API. Socket.IO starts with
 * HTTP long-polling and upgrades to a WebSocket when the network allows it.
 */
let socket: Promise<Socket> | null = null;
let connected = false;
const handlers = new Map<Event, Set<Handler>>();
const reconnectHandlers = new Set<() => void>();

function ensureSocket(): Promise<Socket> {
  socket ??= import('socket.io-client').then(({ io }) => {
    // No trailing slash: Next.js would redirect it (see the server side in apps/api).
    const s = io({ path: REALTIME_PATH, addTrailingSlash: false, withCredentials: true });
    let connectedBefore = false;
    s.on('connect', () => {
      connected = true;
      // Anything pushed while we were offline was missed; screens re-fetch to catch up.
      if (connectedBefore) reconnectHandlers.forEach((fn) => fn());
      connectedBefore = true;
    });
    s.on('disconnect', (reason) => {
      connected = false;
      // The server ended this session (logged out elsewhere): don't try again.
      if (reason === 'io server disconnect') closeRealtime();
    });
    for (const event of Object.values(REALTIME_EVENTS)) {
      s.on(event, (message: ChatMessage) => handlers.get(event)?.forEach((fn) => fn(message)));
    }
    return s;
  });
  return socket;
}

/** Listens for a pushed event. Returns a function that stops listening. */
export function onRealtime(event: Event, handler: Handler): () => void {
  void ensureSocket().catch(() => {
    socket = null; // chunk failed to load (offline); the next subscriber tries again
  });
  const set = handlers.get(event) ?? new Set();
  set.add(handler);
  handlers.set(event, set);
  return () => set.delete(handler);
}

/** False while offline or before the first connection: screens then poll instead. */
export function isRealtimeConnected(): boolean {
  return connected;
}

/** Called after the connection comes back, so a screen can fetch what it missed. */
export function onReconnect(handler: () => void): () => void {
  reconnectHandlers.add(handler);
  return () => reconnectHandlers.delete(handler);
}

/** Closes the connection (on logout, so a shared phone stops receiving messages). */
export function closeRealtime(): void {
  const current = socket;
  socket = null;
  connected = false;
  void current?.then((s) => s.disconnect());
}
