import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AppLogger } from '../../common/logger/app-logger.service';
import { RedisService } from './redis.service';

/** Release only when the token still matches (never delete someone else's lock). */
const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/** Same ownership check before extending the TTL from the watchdog. */
const RENEW_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

const RETRY_INTERVAL_MS = 50;

export class LockUnavailableError extends Error {
  constructor(readonly lockName: string) {
    super(`lock "${lockName}" is held`);
    this.name = 'LockUnavailableError';
  }
}

export interface WithLockOptions {
  /** Lock TTL, renewed by a watchdog while `fn` runs (default 30 s). */
  ttlMs?: number;
  /** Wait up to this long for a held lock before giving up (default 0 = fail fast). */
  waitMs?: number;
}

/**
 * Distributed locks on Redis `SET NX PX` with token-checked release and
 * watchdog renewal — used to serialize per-conversation processing
 * (message-flow.md step 5: at most one reply job per conversation).
 */
@Injectable()
export class LockService {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {}

  async withLock<T>(name: string, fn: () => Promise<T>, options: WithLockOptions = {}): Promise<T> {
    const key = `lock:${name}`;
    const ttlMs = options.ttlMs ?? 30_000;
    const token = randomUUID();
    const deadline = Date.now() + (options.waitMs ?? 0);

    while ((await this.redis.client.set(key, token, 'PX', ttlMs, 'NX')) !== 'OK') {
      if (Date.now() >= deadline) {
        throw new LockUnavailableError(name);
      }
      await sleep(RETRY_INTERVAL_MS);
    }

    const watchdog = setInterval(
      () => {
        void this.renew(key, token, ttlMs);
      },
      Math.max(ttlMs / 2, 100),
    );
    watchdog.unref();

    try {
      return await fn();
    } finally {
      clearInterval(watchdog);
      await this.release(key, token);
    }
  }

  private async release(key: string, token: string): Promise<void> {
    try {
      await this.redis.client.eval(RELEASE_SCRIPT, 1, key, token);
    } catch (error) {
      this.logger.warn(`lock release failed for ${key}: ${String(error)}`, LockService.name);
    }
  }

  private async renew(key: string, token: string, ttlMs: number): Promise<void> {
    try {
      await this.redis.client.eval(RENEW_SCRIPT, 1, key, token, String(ttlMs));
    } catch (error) {
      this.logger.warn(`lock renew failed for ${key}: ${String(error)}`, LockService.name);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
