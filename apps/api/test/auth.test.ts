import { auditLog, otpChallenges, users } from '@souqna/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_ORIGIN,
  createTestApp,
  login,
  randomIp,
  randomPhone,
  requestCode,
  sessionCookie,
  toE164,
  writeHeaders,
  type TestApp,
} from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const verify = (challengeId: string, code: string, extra: Record<string, string> = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/api/auth/otp/verify',
    headers: { ...writeHeaders, ...extra },
    payload: { challengeId, code },
    remoteAddress: randomIp(),
  });

const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('OTP request', () => {
  it('rejects numbers that are not Sudanese mobiles', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      headers: writeHeaders,
      payload: { phone: '+971501234567' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'validation_failed', fields: { phone: 'invalid_phone' } });
  });

  it('stores only a hash of the code and an encrypted phone number', async () => {
    const phone = randomPhone();
    const { challengeId, code } = await requestCode(t, phone);
    const [row] = await t.db.db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.id, challengeId));
    expect(row!.codeHash.toString('hex')).not.toContain(code);
    expect(row!.phoneEnc.toString('utf8')).not.toContain(phone.slice(1));
    expect(row!.phoneHash.toString('utf8')).not.toContain(phone.slice(1));
  });

  it('enforces a resend cooldown per phone number', async () => {
    const phone = randomPhone();
    await requestCode(t, phone);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      headers: writeHeaders,
      payload: { phone },
      remoteAddress: randomIp(),
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('allows at most 3 codes per number in 10 minutes', async () => {
    const phone = randomPhone();
    const hash = phoneHash(phone).toString('hex');
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      await t.redis.del(`cd:otp:${hash}`); // skip the 60 s cooldown, keep the counters
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/auth/otp/request',
        headers: writeHeaders,
        payload: { phone },
        remoteAddress: randomIp(),
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
  });

  it('limits requests per IP address', async () => {
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/auth/otp/request',
        headers: writeHeaders,
        payload: { phone: randomPhone() },
        remoteAddress: ip,
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it('never writes the phone number or the code to the logs', async () => {
    const phone = randomPhone();
    await login(t, phone);
    const all = t.logs.join('\n');
    expect(all).not.toContain(phone.slice(1));
    expect(all).not.toContain(t.sms.lastCodeFor(toE164(phone))!);
  });
});

describe('OTP verify', () => {
  it('logs in a new user and sets a secure, httpOnly session cookie', async () => {
    const { challengeId, code } = await requestCode(t, randomPhone());
    const res = await verify(challengeId, code);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ isNewUser: true });

    const cookie = res.cookies.find((c) => c.name === 'sq_sid')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');

    const me = await t.app.inject({ url: '/api/me', headers: { cookie: sessionCookie(res) } });
    expect(me.statusCode).toBe(200);
    expect(me.json().profileComplete).toBe(false);
  });

  it('logs in an existing user with the same account', async () => {
    const phone = randomPhone();
    const first = await login(t, phone);
    const second = await login(t, phone);
    const a = await t.app.inject({ url: '/api/me', headers: { cookie: first.cookie } });
    const b = await t.app.inject({ url: '/api/me', headers: { cookie: second.cookie } });
    expect(a.json().id).toBe(b.json().id);
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const { challengeId, code } = await requestCode(t, randomPhone());
    const res = await verify(challengeId, wrongCode(code));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('otp_invalid');
    const [row] = await t.db.db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.id, challengeId));
    expect(row!.attempts).toBe(1);
  });

  it('locks the code after 5 wrong attempts, even if the right code comes next', async () => {
    const { challengeId, code } = await requestCode(t, randomPhone());
    const errors: string[] = [];
    for (let i = 0; i < 5; i++)
      errors.push((await verify(challengeId, wrongCode(code))).json().error);
    expect(errors).toEqual([
      'otp_invalid',
      'otp_invalid',
      'otp_invalid',
      'otp_invalid',
      'otp_too_many_attempts',
    ]);
    const res = await verify(challengeId, code);
    expect(res.json().error).toBe('otp_too_many_attempts');
  });

  it('accepts a code only once', async () => {
    const { challengeId, code } = await requestCode(t, randomPhone());
    expect((await verify(challengeId, code)).statusCode).toBe(200);
    const again = await verify(challengeId, code);
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toBe('otp_expired');
  });

  it('rejects an expired code', async () => {
    const { challengeId, code } = await requestCode(t, randomPhone());
    await t.db.db
      .update(otpChallenges)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(otpChallenges.id, challengeId));
    const res = await verify(challengeId, code);
    expect(res.json().error).toBe('otp_expired');
  });

  it('invalidates the previous code when a new one is requested', async () => {
    const phone = randomPhone();
    const first = await requestCode(t, phone);
    const second = await requestCode(t, phone);
    expect((await verify(first.challengeId, first.code)).json().error).toBe('otp_expired');
    expect((await verify(second.challengeId, second.code)).statusCode).toBe(200);
  });

  it('accepts Arabic-Indic digits in the code', async () => {
    const { challengeId, code } = await requestCode(t, randomPhone());
    const arabic = code.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    expect((await verify(challengeId, arabic)).statusCode).toBe(200);
  });

  it('does not reveal whether a challenge id exists', async () => {
    const res = await verify(crypto.randomUUID(), '123456');
    expect(res.json().error).toBe('otp_invalid');
  });

  it('refuses suspended accounts', async () => {
    const phone = randomPhone();
    await login(t, phone);
    await t.db.db
      .update(users)
      .set({ status: 'suspended' })
      .where(eq(users.phoneHash, phoneHash(phone)));
    const { challengeId, code } = await requestCode(t, phone);
    const res = await verify(challengeId, code);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('account_suspended');
  });

  it('rotates the session on login: the old session stops working', async () => {
    const { cookie: oldCookie } = await login(t);
    const { challengeId, code } = await requestCode(t, randomPhone());
    const res = await verify(challengeId, code, { cookie: oldCookie });
    expect(res.statusCode).toBe(200);
    const newCookie = sessionCookie(res);
    expect(newCookie).not.toBe(oldCookie);
    expect(
      (await t.app.inject({ url: '/api/me', headers: { cookie: oldCookie } })).statusCode,
    ).toBe(401);
  });

  it('writes login events to the audit log without PII', async () => {
    const phone = randomPhone();
    await login(t, phone);
    const rows = await t.db.db.select().from(auditLog).where(eq(auditLog.action, 'auth.signup'));
    expect(rows.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(rows, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(serialised).not.toContain(phone.slice(1));
  });
});

describe('CSRF protection', () => {
  const post = (headers: Record<string, string>) =>
    t.app.inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      headers,
      payload: { phone: randomPhone() },
      remoteAddress: randomIp(),
    });

  it('rejects writes without the CSRF header', async () => {
    const res = await post({ origin: APP_ORIGIN });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('csrf_failed');
  });

  it('rejects writes from another origin', async () => {
    const res = await post({ ...writeHeaders, origin: 'https://evil.example' });
    expect(res.json().error).toBe('csrf_failed');
  });

  it('rejects cross-site requests that omit Origin', async () => {
    const { origin: _origin, ...noOrigin } = writeHeaders;
    const res = await post({ ...noOrigin, 'sec-fetch-site': 'cross-site' });
    expect(res.json().error).toBe('csrf_failed');
  });
});

describe('logout', () => {
  it('ends the session and clears the cookie', async () => {
    const { cookie } = await login(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { ...writeHeaders, cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === 'sq_sid')?.value).toBe('');
    expect((await t.app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('security headers', () => {
  it('sets a strict CSP and other secure headers on API responses', async () => {
    const res = await t.app.inject({ url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
  });
});

function phoneHash(localPhone: string): Buffer {
  return t.app.ctx.hashPhone(toE164(localPhone));
}

describe('global rate limit', () => {
  it('limits any single IP to 300 requests a minute, with a Retry-After header', async () => {
    const ip = randomIp();
    let last;
    for (let i = 0; i < 301; i++) {
      last = await t.app.inject({ url: '/api/health', remoteAddress: ip });
    }
    expect(last!.statusCode).toBe(429);
    expect(last!.json()).toMatchObject({ error: 'rate_limited' });
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
    // Another IP is unaffected.
    expect((await t.app.inject({ url: '/api/health', remoteAddress: randomIp() })).statusCode).toBe(
      200,
    );
  });
});
