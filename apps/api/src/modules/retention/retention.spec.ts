import { describe, expect, it, vi } from 'vitest';

import {
  RETENTION_CRON,
  RETENTION_TARGETS,
  drainTable,
  formatRetentionSummary,
  retentionCutoff,
  runRetention,
  type RetentionTable,
} from './retention';

describe('retentionCutoff', () => {
  it('subtracts the configured window in days (365 = 12 months)', () => {
    const now = new Date('2026-10-18T12:00:00.000Z');

    expect(retentionCutoff(now, 365).toISOString()).toBe('2025-10-18T12:00:00.000Z');
    expect(retentionCutoff(now, 30).toISOString()).toBe('2026-09-18T12:00:00.000Z');
  });

  it('rejects a non-positive window', () => {
    expect(() => retentionCutoff(new Date(), 0)).toThrow('positive');
    expect(() => retentionCutoff(new Date(), Number.NaN)).toThrow('positive');
  });
});

describe('drainTable', () => {
  it('loops until a short batch and sums the deletions', async () => {
    const batches = [3, 2];
    const deleteBatch = vi.fn(async () => batches.shift() ?? 0);

    await expect(drainTable({ name: 'messages', deleteBatch }, new Date(), 3)).resolves.toBe(5);
    expect(deleteBatch).toHaveBeenCalledTimes(2);
  });

  it('stops after an exact multiple plus an empty probe batch', async () => {
    const batches = [3, 3, 0];
    const deleteBatch = vi.fn(async () => batches.shift() ?? 0);

    await expect(drainTable({ name: 'messages', deleteBatch }, new Date(), 3)).resolves.toBe(6);
    expect(deleteBatch).toHaveBeenCalledTimes(3);
  });

  it('propagates a failed batch so BullMQ retries the job', async () => {
    const deleteBatch = vi.fn(async () => {
      throw new Error('deadlock detected');
    });

    await expect(drainTable({ name: 'messages', deleteBatch }, new Date(), 3)).rejects.toThrow(
      'deadlock detected',
    );
  });

  it('rejects a bad batch size', async () => {
    const deleteBatch = vi.fn(async () => 0);

    await expect(drainTable({ name: 'messages', deleteBatch }, new Date(), 0)).rejects.toThrow(
      'batch size',
    );
  });
});

describe('runRetention', () => {
  it('drains tables in the configured order and reports counts + cutoff', async () => {
    const order: string[] = [];
    const tables: RetentionTable[] = [
      'answer_events',
      'messages',
      'conversations',
      'audit_logs',
    ].map((name) => ({
      name,
      deleteBatch: async () => {
        order.push(name);
        return name === 'messages' ? 2 : 0;
      },
    }));

    const cutoff = new Date('2025-10-18T12:00:00.000Z');
    const result = await runRetention(tables, cutoff, 10);

    expect(order).toEqual(['answer_events', 'messages', 'conversations', 'audit_logs']);
    expect(result).toEqual({
      cutoff: cutoff.toISOString(),
      deleted: { answer_events: 0, messages: 2, conversations: 0, audit_logs: 0 },
      total: 2,
    });
  });
});

describe('RETENTION_TARGETS', () => {
  it('deletes events → messages → conversations (FK-safe) and never documents/KBs', () => {
    const names = RETENTION_TARGETS.map((target) => target.name);

    expect(names).toEqual(['answer_events', 'messages', 'conversations', 'audit_logs']);
    for (const kept of ['documents', 'chunks', 'knowledge_bases', 'users', 'settings']) {
      expect(names).not.toContain(kept);
    }
  });

  it('runs daily at 03:00 UTC', () => {
    expect(RETENTION_CRON).toBe('0 3 * * *');
  });
});

describe('formatRetentionSummary', () => {
  it('renders the cutoff date, total and per-table breakdown', () => {
    expect(
      formatRetentionSummary({
        cutoff: '2025-10-18T00:00:00.000Z',
        deleted: { answer_events: 4, messages: 7, conversations: 2, audit_logs: 1 },
        total: 14,
      }),
    ).toBe(
      'retention done: cutoff=2025-10-18 deleted=14 ' +
        '(answer_events=4, messages=7, conversations=2, audit_logs=1) — documents/KBs untouched',
    );
  });
});
