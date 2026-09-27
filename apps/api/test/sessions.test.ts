import { sessions } from '@souqna/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, login, randomPhone, writeHeaders, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const me = (cookie: string) => t.app.inject({ url: '/api/me', headers: { cookie } });
const listSessions = (cookie: string) =>
  t.app.inject({ url: '/api/auth/sessions', headers: { cookie } });

describe('device list', () => {
  it('lists only my own active sessions and marks the current one', async () => {
    const phone = randomPhone();
    const android = await login(t, phone, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit Chrome/120 Mobile Safari/537.36',
      },
    });
    await login(t, phone);
    await login(t); // someone else

    const res = await listSessions(android.cookie);
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(2);
    expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(list.find((s: { current: boolean }) => s.current).deviceLabel).toBe('Chrome · Android');
  });

  it('logs out all other devices but keeps this one', async () => {
    const phone = randomPhone();
    const a = await login(t, phone);
    const b = await login(t, phone);
    const c = await login(t, phone);

    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/sessions/revoke-others',
      headers: { ...writeHeaders, cookie: c.cookie },
    });
    expect(res.json()).toEqual({ revoked: 2 });
    expect((await me(a.cookie)).statusCode).toBe(401);
    expect((await me(b.cookie)).statusCode).toBe(401);
    expect((await me(c.cookie)).statusCode).toBe(200);
  });

  it('can log out one specific device of my own', async () => {
    const phone = randomPhone();
    const a = await login(t, phone);
    const b = await login(t, phone);
    const target = (await listSessions(b.cookie))
      .json()
      .find((s: { current: boolean }) => !s.current);

    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${target.id}`,
      headers: { ...writeHeaders, cookie: b.cookie },
    });
    expect(res.statusCode).toBe(204);
    expect((await me(a.cookie)).statusCode).toBe(401);
    expect((await me(b.cookie)).statusCode).toBe(200);
  });
});

describe('IDOR: other users’ sessions', () => {
  it('cannot revoke another user’s session, and learns nothing about it', async () => {
    const victim = await login(t);
    const attacker = await login(t);
    const victimSession = (await listSessions(victim.cookie)).json()[0];

    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${victimSession.id}`,
      headers: { ...writeHeaders, cookie: attacker.cookie },
    });
    // Same answer as for an id that doesn't exist.
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });

    const missing = await t.app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${crypto.randomUUID()}`,
      headers: { ...writeHeaders, cookie: attacker.cookie },
    });
    expect(missing.json()).toEqual(res.json());
    expect((await me(victim.cookie)).statusCode).toBe(200);
  });

  it('never lists another user’s sessions', async () => {
    const victim = await login(t);
    const attacker = await login(t);
    const victimIds = (await listSessions(victim.cookie)).json().map((s: { id: string }) => s.id);
    const attackerIds = (await listSessions(attacker.cookie))
      .json()
      .map((s: { id: string }) => s.id);
    expect(attackerIds.some((id: string) => victimIds.includes(id))).toBe(false);
  });
});

describe('session validity', () => {
  it('rejects requests without a session', async () => {
    const res = await t.app.inject({ url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthenticated' });
  });

  it('rejects a forged token', async () => {
    expect((await me('sq_sid=not-a-real-token')).statusCode).toBe(401);
  });

  it('rejects an expired session', async () => {
    const { cookie } = await login(t);
    const id = (await listSessions(cookie)).json()[0].id;
    await t.db.db
      .update(sessions)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(sessions.id, id));
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('rejects a session idle for more than 30 days', async () => {
    const { cookie } = await login(t);
    const id = (await listSessions(cookie)).json()[0].id;
    await t.db.db
      .update(sessions)
      .set({ lastSeenAt: sql`now() - interval '31 days'` })
      .where(eq(sessions.id, id));
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('stores only a hash of the session token', async () => {
    const { cookie } = await login(t);
    const token = cookie.split('=')[1]!;
    const rows = await t.db.db.select({ tokenHash: sessions.tokenHash }).from(sessions);
    expect(rows.some((r) => r.tokenHash.toString('base64url') === token)).toBe(false);
  });
});
