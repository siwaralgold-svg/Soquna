import { headers } from 'next/headers';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * GET from the API while rendering on the server. Forwards the visitor's IP (for the API's
 * rate limits) and, when `withSession` is set, their cookies (so a seller can see their own
 * drafts). Returns null for 404 so pages can show "not found".
 */
export async function serverGet<T>(path: string, { withSession = false } = {}): Promise<T | null> {
  const incoming = await headers();
  const forward: Record<string, string> = {};
  const ip = incoming.get('x-forwarded-for');
  if (ip) forward['x-forwarded-for'] = ip;
  const cookie = incoming.get('cookie');
  if (withSession && cookie) forward.cookie = cookie;

  const res = await fetch(`${API_URL}/api${path}`, { headers: forward, cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}
