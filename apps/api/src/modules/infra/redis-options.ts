import type { RedisOptions } from 'ioredis';

/**
 * Parse REDIS_URL into ioredis options with an explicit logical DB
 * (ADR-0006: db 0 = queue, db 1 = cache) — single Redis instance, split DBs.
 */
export function redisOptions(redisUrl: string, db: number): RedisOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db,
  };
}
