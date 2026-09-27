// Tiny IndexedDB key-value store for offline drafts. IndexedDB (unlike localStorage) can keep
// photo Blobs, so a seller can take photos with no signal and upload them later.
// Every call fails soft: private browsing or a full disk just means no draft is kept.

const DB_NAME = 'souqna';
const STORE = 'drafts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}

export const loadDraft = <T>(key: string) => run<T>('readonly', (s) => s.get(key));
export const saveDraft = (key: string, value: unknown) =>
  run('readwrite', (s) => s.put(value, key));
export const deleteDraft = (key: string) => run('readwrite', (s) => s.delete(key));
