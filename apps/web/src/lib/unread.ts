/** Lets screens tell the bottom navigation that the unread count may have changed. */
const EVENT = 'souqna:unread-changed';

export function notifyUnreadChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function onUnreadChanged(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
