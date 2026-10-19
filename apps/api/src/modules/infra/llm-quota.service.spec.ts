import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { CacheService } from './cache.service';
import {
  LLM_DAILY_LIMIT_MESSAGE,
  LLM_RATE_LIMITED_MESSAGE,
  LLM_USER_REQUESTS_PER_MINUTE,
  LlmQuotaService,
} from './llm-quota.service';

function buildHarness(options: { dailyLimit?: number; userCounter?: number | null } = {}) {
  const counters = new Map<string, number>();
  const incrWithTtl = vi.fn(async (key: string, ttlSeconds: number) => {
    void ttlSeconds;
    if (key.startsWith('quota:llm:user:') && options.userCounter !== undefined) {
      return options.userCounter === null ? null : options.userCounter + 1;
    }
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return next;
  });

  const cache = { incrWithTtl } as unknown as CacheService;
  const config = {
    get: vi.fn((key: string) =>
      key === 'LLM_DAILY_REQUEST_LIMIT' ? (options.dailyLimit ?? 0) : undefined,
    ),
  } as unknown as ConfigService;

  return { service: new LlmQuotaService(cache, config), counters, incrWithTtl };
}

describe('LlmQuotaService.enforce', () => {
  it('allows requests under the per-user cap and skips the daily counter when disabled', async () => {
    const { service, counters } = buildHarness({ dailyLimit: 0 });

    await expect(service.enforce('user-1')).resolves.toBeUndefined();
    expect([...counters.keys()]).toEqual(['quota:llm:user:user-1']);
  });

  it('throws 429 past the per-user per-minute cap', async () => {
    const { service } = buildHarness({ userCounter: LLM_USER_REQUESTS_PER_MINUTE });

    await expect(service.enforce('user-1')).rejects.toThrow(LLM_RATE_LIMITED_MESSAGE);
    await expect(service.enforce('user-1')).rejects.toBeInstanceOf(HttpException);
  });

  it('enforces the global daily budget when enabled', async () => {
    const { service } = buildHarness({ dailyLimit: 2 });

    await expect(service.enforce('user-1')).resolves.toBeUndefined();
    await expect(service.enforce('user-2')).resolves.toBeUndefined();
    await expect(service.enforce('user-3')).rejects.toThrow(LLM_DAILY_LIMIT_MESSAGE);
  });

  it('fails open when Redis is unavailable', async () => {
    const { service } = buildHarness({ userCounter: null });

    await expect(service.enforce('user-1')).resolves.toBeUndefined();
  });
});
