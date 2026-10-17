import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppLogger } from '../../common/logger/app-logger.service';
import { LockService, LockUnavailableError } from './lock.service';
import type { RedisService } from './redis.service';

function buildService(setResult: string | null = 'OK') {
  const set = vi.fn(async (..._args: unknown[]) => setResult);
  const evalFn = vi.fn(async (..._args: unknown[]) => 1);
  const redis = { client: { set, eval: evalFn } } as unknown as RedisService;
  const logger = {
    warn: vi.fn(async () => undefined),
    log: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as AppLogger;

  return { service: new LockService(redis, logger), set, evalFn, logger };
}

describe('LockService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs fn while holding the lock and releases with the owner token', async () => {
    const { service, set, evalFn } = buildService();

    await expect(service.withLock('conversation:42', async () => 'done')).resolves.toBe('done');

    expect(set).toHaveBeenCalledWith(
      'lock:conversation:42',
      expect.any(String),
      'PX',
      30_000,
      'NX',
    );
    const token = set.mock.calls[0]?.[1];
    expect(evalFn).toHaveBeenCalledWith(
      expect.stringContaining("'del'"),
      1,
      'lock:conversation:42',
      token,
    );
  });

  it('releases the lock when fn throws', async () => {
    const { service, evalFn } = buildService();

    await expect(
      service.withLock('conversation:42', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(evalFn).toHaveBeenCalledTimes(1);
  });

  it('fails fast when the lock is held elsewhere', async () => {
    const { service, evalFn } = buildService(null);

    await expect(service.withLock('conversation:42', async () => 'never')).rejects.toBeInstanceOf(
      LockUnavailableError,
    );

    expect(evalFn).not.toHaveBeenCalled();
  });

  it('renews the TTL from the watchdog while fn runs', async () => {
    vi.useFakeTimers();
    const { service, evalFn } = buildService();

    let finish!: () => void;
    const running = service.withLock(
      'conversation:42',
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    await vi.advanceTimersByTimeAsync(16_000); // watchdog fires at ttl / 2 = 15 s

    expect(evalFn).toHaveBeenCalledWith(
      expect.stringContaining('pexpire'),
      1,
      'lock:conversation:42',
      expect.any(String),
      '30000',
    );

    finish();
    await running;
  });
});
