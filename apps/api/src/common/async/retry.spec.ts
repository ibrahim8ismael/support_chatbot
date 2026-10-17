import { describe, expect, it, vi } from 'vitest';

import { withRetries } from './retry';

describe('withRetries', () => {
  it('returns the first result without retrying', async () => {
    const run = vi.fn(async () => 'ok');

    await expect(withRetries(run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries with exponential backoff until it succeeds', async () => {
    let calls = 0;
    const run = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error(`flaky ${calls}`);
      }
      return 'recovered';
    });
    const onRetry = vi.fn();

    await expect(withRetries(run, { baseDelayMs: 1, onRetry })).resolves.toBe('recovered');
    expect(run).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map(([, attempt]) => attempt)).toEqual([1, 2]);
  });

  it('rethrows the last error after the attempts are exhausted', async () => {
    let calls = 0;
    const run = vi.fn(async () => {
      calls += 1;
      throw new Error(`boom ${calls}`);
    });

    await expect(withRetries(run, { attempts: 2, baseDelayMs: 1 })).rejects.toThrow('boom 2');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
