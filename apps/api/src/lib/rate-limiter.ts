import type { Redis } from 'ioredis';
import { AppError } from './errors';

export interface Limit {
  /** Stable name, e.g. `otp:phone:10m`. */
  name: string;
  max: number;
  windowSeconds: number;
}

/**
 * Fixed-window counters in Redis. Keys only ever contain hashed identifiers, never raw
 * phone numbers or IPs.
 */
export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  /** Counts one hit against every limit; throws `rate_limited` if any is exceeded. */
  async consume(identifier: string, limits: readonly Limit[]): Promise<void> {
    const pipeline = this.redis.multi();
    for (const limit of limits) {
      const key = `rl:${limit.name}:${identifier}`;
      pipeline.incr(key);
      pipeline.expire(key, limit.windowSeconds, 'NX');
      pipeline.ttl(key);
    }
    const results = (await pipeline.exec()) ?? [];

    let retryAfter = 0;
    limits.forEach((limit, i) => {
      const count = Number(results[i * 3]?.[1] ?? 0);
      const ttl = Number(results[i * 3 + 2]?.[1] ?? limit.windowSeconds);
      if (count > limit.max) retryAfter = Math.max(retryAfter, ttl);
    });
    if (retryAfter > 0) throw new AppError('rate_limited', { retryAfterSeconds: retryAfter });
  }

  /** Sets a cooldown; returns the remaining seconds if one is already active. */
  async cooldown(name: string, identifier: string, seconds: number): Promise<number> {
    const key = `cd:${name}:${identifier}`;
    const set = await this.redis.set(key, '1', 'EX', seconds, 'NX');
    if (set === 'OK') return 0;
    return Math.max(await this.redis.ttl(key), 1);
  }
}
