import { describe, expect, it, vi } from 'vitest';

import { kbVersionKey, type Settings } from '@support-agent/shared';

import type { DatabaseService } from '../../db/database.service';
import type { CacheService } from '../infra/cache.service';
import type { LlmService } from '../llm/llm.service';
import type { SettingsService } from '../settings/settings.service';
import { RetrievalService } from './retrieval.service';

const KB_A = '11111111-1111-4111-8111-111111111111';
const KB_B = '22222222-2222-4222-8222-222222222222';

const SETTINGS = {
  retrieval_top_k: 10,
  retrieval_score_threshold: 0.35,
} as unknown as Settings;

interface HarnessOptions {
  rows?: Array<Record<string, unknown>>;
  cached?: unknown;
  embeddings?: number[][];
}

function buildHarness(options: HarnessOptions = {}) {
  const limit = vi.fn(async (_count: number) => options.rows ?? []);
  const orderBy = vi.fn((..._args: unknown[]) => ({ limit }));
  const where = vi.fn((..._args: unknown[]) => ({ orderBy }));
  const innerJoin = vi.fn((..._args: unknown[]) => ({ where }));
  const from = vi.fn((..._args: unknown[]) => ({ innerJoin }));
  const select = vi.fn((..._args: unknown[]) => ({ from }));
  const database = { db: { select } } as unknown as DatabaseService;

  const embed = vi.fn(async (texts: string[]) => ({
    embeddings: options.embeddings ?? texts.map(() => new Array<number>(1536).fill(0.01)),
  }));
  const llm = { embed } as unknown as LlmService;

  const versions = new Map<string, number>();
  const get = vi.fn(async (key: string) => {
    if (key.startsWith('kb:')) {
      return versions.get(key);
    }
    return options.cached;
  });
  const set = vi.fn(async (_key: string, _value: unknown, _ttl: number) => undefined);
  const cache = { get, set } as unknown as CacheService;

  const settings = { get: vi.fn(async () => SETTINGS) } as unknown as SettingsService;

  const service = new RetrievalService(database, llm, settings, cache);

  return { service, select, limit, embed, get, set, versions };
}

describe('RetrievalService.retrieve', () => {
  it('embeds the normalized query, filters by threshold, and caches the result', async () => {
    const rows = [
      {
        chunkId: 'c1',
        documentId: 'd1',
        kbId: KB_A,
        content: 'Reset steps.',
        metadata: { heading: 'Password reset', page: 1 },
        filename: 'guide.pdf',
        score: 0.81,
      },
      {
        chunkId: 'c2',
        documentId: 'd1',
        kbId: KB_A,
        content: 'Other.',
        metadata: null,
        filename: 'guide.pdf',
        score: 0.4,
      },
    ];
    const { service, embed, limit, set } = buildHarness({ rows });

    const result = await service.retrieve('  How do I   reset?  ', [KB_A]);

    expect(embed).toHaveBeenCalledWith(['How do I reset?']);
    expect(limit).toHaveBeenCalledWith(10);
    expect(result.chunks).toEqual([
      expect.objectContaining({
        chunkId: 'c1',
        score: 0.81,
        filename: 'guide.pdf',
        metadata: { heading: 'Password reset', page: 1 },
      }),
      expect.objectContaining({ chunkId: 'c2', score: 0.4, metadata: {} }),
    ]);
    expect(result.trace).toMatchObject({
      normalizedQuery: 'How do I reset?',
      kbIds: [KB_A],
      topK: 10,
      threshold: 0.35,
      bestScore: 0.81,
      returnedChunks: 2,
      cacheHit: false,
    });

    expect(set).toHaveBeenCalledTimes(1);
    const [key, value, ttl] = set.mock.calls[0] ?? [];
    expect(String(key)).toMatch(new RegExp(`^ret:v1:${KB_A}=0:[0-9a-f]{64}$`));
    expect(ttl).toBe(900);
    expect(value).toHaveLength(2);
  });

  it('serves repeated searches from the versioned retrieval cache', async () => {
    const cached = [
      {
        chunkId: 'c9',
        documentId: 'd1',
        kbId: KB_A,
        filename: 'guide.pdf',
        score: 0.9,
        metadata: {},
        content: 'Cached.',
      },
    ];
    const { service, embed, select, get, versions } = buildHarness({ cached });
    versions.set(kbVersionKey(KB_A), 7);

    const result = await service.retrieve('Password reset', [KB_A]);

    expect(result.trace.cacheHit).toBe(true);
    expect(result.chunks).toEqual(cached);
    expect(result.trace.bestScore).toBe(0.9);
    expect(embed).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(kbVersionKey(KB_A));
    const keys = get.mock.calls.map(([key]) => key);
    expect(keys.some((key) => key.includes(`ret:v1:${KB_A}=7:`))).toBe(true);
  });

  it('honors per-call overrides and dedupes/sorts KB ids', async () => {
    const { service, limit } = buildHarness();

    const result = await service.retrieve('q', [KB_B, KB_A, KB_B], { topK: 3, threshold: 0.9 });

    expect(result.trace.kbIds).toEqual([KB_A, KB_B]);
    expect(result.trace).toMatchObject({ topK: 3, threshold: 0.9 });
    expect(limit).toHaveBeenCalledWith(3);
  });

  it('returns an empty result without embedding when there is nothing to search', async () => {
    const { service, embed } = buildHarness();

    const emptyKbs = await service.retrieve('anything', []);
    const blankQuery = await service.retrieve('   ', [KB_A]);

    expect(emptyKbs.chunks).toEqual([]);
    expect(blankQuery.chunks).toEqual([]);
    expect(blankQuery.trace.bestScore).toBeNull();
    expect(embed).not.toHaveBeenCalled();
  });

  it('throws when the embedding provider returns no vector', async () => {
    const { service, set } = buildHarness({ embeddings: [] });

    await expect(service.retrieve('q', [KB_A])).rejects.toThrow(/no vector/);
    expect(set).not.toHaveBeenCalled();
  });
});
