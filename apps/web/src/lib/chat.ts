import type { ChatMessage } from '@souqna/contracts';

/**
 * Adds or replaces messages by id and keeps them in order. Message ids come from a
 * database sequence, so they only grow; compared as BigInt because they are strings.
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const d = BigInt(a.id) - BigInt(b.id);
    return d < 0n ? -1 : d > 0n ? 1 : 0;
  });
}

/** A message the user sent that the server hasn't confirmed yet. */
export interface Outgoing {
  localId: string;
  /** Same key on every retry, so a message is never stored twice. */
  idempotencyKey: string;
  kind: 'text' | 'image' | 'offer';
  text?: string;
  amount?: string;
  /** The photo, kept (in IndexedDB too) until it is uploaded. */
  blob?: Blob;
  photoId?: string;
  /** Image shown while sending: a local blob: URL, or the uploaded photo. */
  preview?: string;
  state: 'sending' | 'waiting' | 'failed';
  /** Error code when the server refused it for good. */
  error?: string;
}

/** What survives a reload (in IndexedDB, which can keep the photo Blob). */
export type StoredOutgoing = Omit<Outgoing, 'state' | 'preview'> & { state: 'waiting' | 'failed' };

export function toStored(item: Outgoing): StoredOutgoing {
  const { preview, state, ...rest } = item;
  void preview; // blob: URLs die with the page; rebuilt on restore
  return { ...rest, state: state === 'failed' ? 'failed' : 'waiting' };
}

export const outboxKey = (conversationId: string) => `chat-outbox:${conversationId}`;

export function newLocalId(): string {
  return crypto.randomUUID();
}
