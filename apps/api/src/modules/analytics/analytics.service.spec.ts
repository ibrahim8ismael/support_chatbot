import { describe, expect, it, vi } from 'vitest';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { DatabaseService } from '../../db/database.service';
import { AnalyticsService } from './analytics.service';
import { answerEvents } from './entities/answer-event.entity';
import { auditLogs } from './entities/audit-log.entity';

function buildHarness(options: { fail?: boolean } = {}) {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn(async (values: Record<string, unknown>) => {
      if (options.fail) {
        throw new Error('db down');
      }
      inserted.push({ table, values });
    }),
  }));

  const database = { db: { insert } } as unknown as DatabaseService;
  const logger = { error: vi.fn() } as unknown as AppLogger;

  return { service: new AnalyticsService(database, logger), inserted, logger };
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
