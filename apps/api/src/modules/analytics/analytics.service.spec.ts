import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { DatabaseService } from '../../db/database.service';
import { AnalyticsService } from './analytics.service';
import { answerEvents } from './entities/answer-event.entity';
import { auditLogs } from './entities/audit-log.entity';

function buildHarness(options: { fail?: boolean; results?: unknown[][] } = {}) {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn(async (values: Record<string, unknown>) => {
      if (options.fail) {
        throw new Error('db down');
      }
      inserted.push({ table, values });
    }),
  }));

  const results = [...(options.results ?? [])];
  const execute = vi.fn(async (_query: unknown) => {
    const next = results.shift();
    if (!next) {
      throw new Error('no canned execute result');
    }
    return next;
  });

  const database = { db: { insert, execute } } as unknown as DatabaseService;
  const logger = { error: vi.fn() } as unknown as AppLogger;

  return { service: new AnalyticsService(database, logger), inserted, execute, logger };
}

describe('AnalyticsService.recordAnswerEvent', () => {
  it('inserts the full row with null/default fallbacks', async () => {
    const { service, inserted } = buildHarness();

    await service.recordAnswerEvent({
      conversationId: 'conv-1',
      incomingMessageId: 'msg-1',
      outcome: 'answered',
      queryText: 'how do i reset my password?',
      topK: 10,
      topScore: 0.8,
      retrievedChunkIds: ['chunk-1', 'chunk-2'],
      retrievalMs: 12,
      generationMs: 300,
      totalMs: 400,
      chatModel: 'mock-chat',
      tokensIn: 42,
      tokensOut: 7,
    });

    expect(inserted).toEqual([
      {
        table: answerEvents,
        values: {
          conversationId: 'conv-1',
          incomingMessageId: 'msg-1',
          outgoingMessageId: null,
          outcome: 'answered',
          queryText: 'how do i reset my password?',
          topK: 10,
          topScore: 0.8,
          retrievedChunkIds: ['chunk-1', 'chunk-2'],
          embeddingMs: null,
          retrievalMs: 12,
          generationMs: 300,
          totalMs: 400,
          embeddingModel: null,
          chatModel: 'mock-chat',
          tokensIn: 42,
          tokensOut: 7,
          estimatedCostUsd: null,
        },
      },
    ]);
  });

  it('defaults the chunk list to an empty array', async () => {
    const { service, inserted } = buildHarness();

    await service.recordAnswerEvent({
      conversationId: 'conv-1',
      incomingMessageId: 'msg-1',
      outcome: 'escalated_low_score',
      queryText: 'q',
    });

    expect(inserted[0]?.values).toMatchObject({
      outcome: 'escalated_low_score',
      retrievedChunkIds: [],
      topScore: null,
    });
  });

  it('swallows insert failures and logs them — analytics never breaks a reply', async () => {
    const { service, inserted, logger } = buildHarness({ fail: true });

    await expect(
      service.recordAnswerEvent({
        conversationId: 'conv-1',
        incomingMessageId: 'msg-1',
        outcome: 'answered',
        queryText: 'q',
      }),
    ).resolves.toBeUndefined();

    expect(inserted).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('answer event'),
      'AnalyticsService',
    );
  });
});

describe('AnalyticsService.recordAuditLog', () => {
  it('inserts the actor, action, entity and context', async () => {
    const { service, inserted } = buildHarness();

    await service.recordAuditLog({
      userId: 'user-1',
      action: 'setting.update',
      entity: 'settings',
      data: { changes: { max_reply_chars: { from: 800, to: 600 } } },
    });

    expect(inserted).toEqual([
      {
        table: auditLogs,
        values: {
          userId: 'user-1',
          action: 'setting.update',
          entity: 'settings',
          entityId: null,
          data: { changes: { max_reply_chars: { from: 800, to: 600 } } },
        },
      },
    ]);
  });

  it('supports anonymous events (failed logins) with no entity id or data', async () => {
    const { service, inserted } = buildHarness();

    await service.recordAuditLog({
      action: 'auth.login_failed',
      entity: 'session',
    });

    expect(inserted[0]?.values).toEqual({
      userId: null,
      action: 'auth.login_failed',
      entity: 'session',
      entityId: null,
      data: null,
    });
  });

  it('swallows insert failures and logs them', async () => {
    const { service, logger } = buildHarness({ fail: true });

    await expect(
      service.recordAuditLog({ action: 'auth.logout', entity: 'session' }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('auth.logout'),
      'AnalyticsService',
    );
  });
});

describe('AnalyticsService.overview', () => {
  it('maps the aggregate row to the contract shape with rates computed', async () => {
    const { service } = buildHarness({
      results: [
        [
          {
            conversations: 40,
            bot_answered: '30',
            escalated_conversations: 6,
            avg_latency_ms: 812.5,
            p95_latency_ms: 2400,
            tokens_in: 12_000,
            tokens_out: 3400,
            estimated_cost_usd: '0.42',
          },
        ],
      ],
    });

    await expect(service.overview({})).resolves.toEqual({
      conversations: 40,
      botAnswered: 30,
      deflectionRate: 0.75,
      escalationRate: 0.15,
      avgLatencyMs: 812.5,
      p95LatencyMs: 2400,
      tokensIn: 12_000,
      tokensOut: 3400,
      estimatedCostUsd: 0.42,
    });
  });

  it('returns zeros for an empty range', async () => {
    const { service } = buildHarness({ results: [[{ conversations: 0 }]] });

    await expect(service.overview({})).resolves.toEqual({
      conversations: 0,
      botAnswered: 0,
      deflectionRate: 0,
      escalationRate: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      estimatedCostUsd: 0,
    });
  });

  it('rejects ranges where from is not before to', async () => {
    const { service, execute } = buildHarness();

    await expect(
      service.overview({ from: '2026-10-18T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('AnalyticsService.timeseries', () => {
  it('maps buckets with per-bucket rates and echoes the resolved range', async () => {
    const { service } = buildHarness({
      results: [
        [
          {
            bucket: new Date('2026-10-17T00:00:00.000Z'),
            conversations: 10,
            bot_answered: 8,
            escalated_conversations: 1,
            avg_latency_ms: 500,
            p95_latency_ms: 900,
            tokens_in: 100,
            tokens_out: 20,
            estimated_cost_usd: 0.01,
          },
          { bucket: new Date('2026-10-18T00:00:00.000Z'), conversations: 0 },
        ],
      ],
    });

    const result = await service.timeseries({
      from: '2026-10-17T00:00:00.000Z',
      to: '2026-10-18T12:00:00.000Z',
      interval: 'day',
    });

    expect(result.interval).toBe('day');
    expect(result.from).toBe('2026-10-17T00:00:00.000Z');
    expect(result.to).toBe('2026-10-18T12:00:00.000Z');
    expect(result.points).toEqual([
      {
        bucket: '2026-10-17T00:00:00.000Z',
        conversations: 10,
        botAnswered: 8,
        deflectionRate: 0.8,
        escalationRate: 0.1,
        avgLatencyMs: 500,
        p95LatencyMs: 900,
        tokensIn: 100,
        tokensOut: 20,
        estimatedCostUsd: 0.01,
      },
      {
        bucket: '2026-10-18T00:00:00.000Z',
        conversations: 0,
        botAnswered: 0,
        deflectionRate: 0,
        escalationRate: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        estimatedCostUsd: 0,
      },
    ]);
  });
});

describe('AnalyticsService.unanswered', () => {
  it('clusters similar queries and returns the strongest groups first', async () => {
    const newest = new Date('2026-10-18T09:00:00.000Z');
    const older = new Date('2026-10-18T08:00:00.000Z');
    const oldest = new Date('2026-10-18T07:00:00.000Z');
    const { service } = buildHarness({
      results: [
        [
          { query_text: 'How do I reset my password?', created_at: newest, conversation_id: 'c1' },
          { query_text: 'how do i reset a password', created_at: older, conversation_id: 'c2' },
          { query_text: 'Do you offer refunds?', created_at: oldest, conversation_id: 'c3' },
        ],
      ],
    });

    await expect(service.unanswered({ limit: 10 })).resolves.toEqual([
      {
        query: 'How do I reset my password?',
        count: 2,
        lastSeen: newest.toISOString(),
        sampleConversationId: 'c1',
      },
      {
        query: 'Do you offer refunds?',
        count: 1,
        lastSeen: oldest.toISOString(),
        sampleConversationId: 'c3',
      },
    ]);
  });
});
