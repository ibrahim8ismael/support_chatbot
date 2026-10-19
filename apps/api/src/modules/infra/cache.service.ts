import { Injectable } from '@nestjs/common';

import { AppLogger } from '../../common/logger/app-logger.service';
import { RedisService } from './redis.service';

/**
 * Application cache (Redis db 1). Always fail-open: errors are logged and
 * treated as misses — answers degrade to uncached, never to wrong
 * (docs/architecture/caching.md). Every key must carry a TTL.
 */
@Injectable()
export class CacheService {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.client.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (error) {
      this.logger.warn(`cache get failed for key ${key}: ${String(error)}`, CacheService.name);
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`cache set failed for key ${key}: ${String(error)}`, CacheService.name);
    }
  }

  /**
   * Increment a counter. Used for KB version keys (docs/architecture/caching.md);
   * counters intentionally have no TTL — they are tiny and must outlive entries.
   */
  async incr(key: string): Promise<void> {
    try {
      await this.redis.client.incr(key);
    } catch (error) {
      this.logger.warn(`cache incr failed for key ${key}: ${String(error)}`, CacheService.name);
    }
  }

  /**
   * Atomically increment a counter and set its TTL on the first write (one Lua
   * script, so a crash between `INCR` and `EXPIRE` cannot leave a TTL-less key
   * behind). Returns the new value, or `null` when Redis is unavailable so
   * callers can fail open. Used by the login throttle (security.md § 1).
   */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number | null> {
    const script =
      "local value = redis.call('INCR', KEYS[1])\n" +
      "if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end\n" +
      'return value';
    try {
      const result: unknown = await this.redis.client.eval(script, 1, key, ttlSeconds);
      return typeof result === 'number' ? result : Number(result);
    } catch (error) {
      this.logger.warn(`cache incr failed for key ${key}: ${String(error)}`, CacheService.name);
      return null;
    }
  }

  /**
   * Set a short-lived marker only when it does not exist yet (`SET NX EX`).
   * Returns `true` when this call created the key, `false` when it already
   * existed and `null` when Redis is unavailable — callers fail open.
   */
  async setNx(key: string, ttlSeconds: number): Promise<boolean | null> {
    try {
      const result = await this.redis.client.set(key, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.warn(`cache setNx failed for key ${key}: ${String(error)}`, CacheService.name);
      return null;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.client.del(key);
    } catch (error) {
      this.logger.warn(`cache del failed for key ${key}: ${String(error)}`, CacheService.name);
    }
  }
}
