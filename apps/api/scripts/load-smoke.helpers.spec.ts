import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LOAD_SMOKE_QUESTIONS,
  buildChatwootWebhookPayload,
  evaluate,
  findRepoRoot,
  formatEvaluation,
  isLocalHost,
  mapConcurrent,
  maskRedisUrl,
  percentile,
  summarize,
} from './load-smoke.helpers';

describe('percentile', () => {
  it('throws on an empty sample', () => {
    expect(() => percentile([], 95)).toThrow();
  });

  it('returns the value itself for a single sample', () => {
    expect(percentile([42], 95)).toBe(42);
  });

  it('uses nearest-rank on a 1–100 sample', () => {
    const sample = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(sample, 50)).toBe(50);
    expect(percentile(sample, 95)).toBe(95);
    expect(percentile(sample, 100)).toBe(100);
    expect(percentile(sample, 1)).toBe(1);
  });

  it('is order-independent', () => {
    expect(percentile([9, 1, 5, 3, 7], 95)).toBe(9);
  });
});

describe('summarize', () => {
  it('reports count/min/p50/p95/max', () => {
    const summary = summarize([10, 20, 30, 40, 100]);
    expect(summary).toEqual({ count: 5, min: 10, p50: 30, p95: 100, max: 100 });
  });
});

describe('evaluate', () => {
  it('passes when p95 equals the limit (boundary is inclusive)', () => {
    const evaluation = evaluate('ack', [10, 10, 10, 10, 10, 10, 10, 10, 10, 300], 300);
    expect(evaluation.p95).toBe(300);
    expect(evaluation.pass).toBe(true);
  });

  it('fails when p95 exceeds the limit', () => {
    const evaluation = evaluate('ack', [10, 10, 10, 10, 10, 10, 10, 10, 10, 301], 300);
    expect(evaluation.pass).toBe(false);
  });

  it('throws on an empty sample', () => {
    expect(() => evaluate('ack', [], 300)).toThrow();
  });
});

describe('formatEvaluation', () => {
  it('renders PASS/FAIL with the limit', () => {
    expect(formatEvaluation(evaluate('ack', [1], 300))).toContain('PASS');
    expect(formatEvaluation(evaluate('ack', [1], 300))).toContain('limit 300ms');
    expect(formatEvaluation(evaluate('ack', [1], 0))).toContain('FAIL');
  });
});

describe('buildChatwootWebhookPayload', () => {
  it('builds a distinct message_created event per index', () => {
    const payload = buildChatwootWebhookPayload(3, { accountId: 7, inboxId: 5 });
    expect(payload.event).toBe('message_created');
    expect(payload.account).toEqual({ id: 7 });
    expect(payload.conversation).toEqual({ id: 80_003, inbox_id: 5, status: 'open' });
    expect(payload.message_type).toBe('incoming');
    expect(typeof payload.content).toBe('string');
    expect(String(payload.content).length).toBeGreaterThan(0);

    const first = buildChatwootWebhookPayload(0, { accountId: 1, inboxId: 1 });
    expect(first.conversation).not.toEqual(payload.conversation);
  });

  it('cycles the question list and respects a custom conversation base', () => {
    const payload = buildChatwootWebhookPayload(LOAD_SMOKE_QUESTIONS.length, {
      accountId: 1,
      inboxId: 1,
      conversationBase: 10,
    });
    expect(payload.conversation).toEqual({
      id: 10 + LOAD_SMOKE_QUESTIONS.length,
      inbox_id: 1,
      status: 'open',
    });
    expect(payload.content).toBe(LOAD_SMOKE_QUESTIONS[0]);
  });
});

describe('mapConcurrent', () => {
  it('keeps input order and respects the concurrency cap', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 12 }, (_, index) => index);

    const results = await mapConcurrent(items, 3, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return item * 2;
    });

    expect(results).toEqual(items.map((item) => item * 2));
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it('propagates rejections', async () => {
    await expect(
      mapConcurrent([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error('boom');
        return item;
      }),
    ).rejects.toThrow('boom');
  });

  it('rejects a concurrency below one', async () => {
    await expect(mapConcurrent([1], 0, async (item) => item)).rejects.toThrow('concurrency');
  });
});

describe('findRepoRoot', () => {
  it('walks up to the workspace root', () => {
    const root = mkdtempSync(join(tmpdir(), 'load-smoke-'));
    try {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n');
      const nested = join(root, 'apps', 'api', 'scripts');
      mkdirSync(nested, { recursive: true });
      expect(findRepoRoot(nested)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns null when no workspace marker exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'load-smoke-'));
    try {
      expect(findRepoRoot(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('maskRedisUrl', () => {
  it('hides the password but keeps the host and db', () => {
    const masked = maskRedisUrl('redis://:hunter2@localhost:6379/0');
    expect(masked).not.toContain('hunter2');
    expect(masked).toContain('localhost:6379');
    expect(masked).toContain('/0');
  });

  it('leaves password-less urls untouched', () => {
    expect(maskRedisUrl('redis://localhost:6379')).toContain('localhost:6379');
  });
});

describe('isLocalHost', () => {
  it('accepts localhost and loopback addresses (v4 + v6)', () => {
    expect(isLocalHost('http://localhost:3001')).toBe(true);
    expect(isLocalHost('http://127.0.0.1:3001')).toBe(true);
    expect(isLocalHost('http://[::1]:3001')).toBe(true);
  });

  it('rejects remote hosts, other loopback-range addresses and garbage', () => {
    expect(isLocalHost('https://support.example.com')).toBe(false);
    expect(isLocalHost('http://10.0.0.5:3001')).toBe(false);
    expect(isLocalHost('not a url')).toBe(false);
  });
});
