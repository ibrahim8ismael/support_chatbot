import { Injectable } from '@nestjs/common';

import type { AnswerOutcome } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { DatabaseService } from '../../db/database.service';
import { answerEvents } from './entities/answer-event.entity';
import { auditLogs } from './entities/audit-log.entity';

/** Audited actions (docs/operations/security.md § Audited actions). */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'knowledge_base.create',
  'knowledge_base.update',
  'knowledge_base.delete',
  'document.upload',
  'document.reprocess',
  'document.delete',
  'binding.update',
  'setting.update',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Everything an `answer_events` row carries (data-model.md § answer_events). */
export interface AnswerEventInput {
  conversationId: string;
  /** The question message. */
  incomingMessageId: string;
  /** The posted answer message, once the caller knows it (T-203). */
  outgoingMessageId?: string | null;
  outcome: AnswerOutcome;
  /** The actual retrieval query (after rewrite). */
  queryText: string;
  topK?: number | null;
  topScore?: number | null;
  retrievedChunkIds?: string[];
  embeddingMs?: number | null;
  retrievalMs?: number | null;
  generationMs?: number | null;
  totalMs?: number | null;
  embeddingModel?: string | null;
  chatModel?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** `numeric(10,6)` as a string — avoids float drift on money. */
  estimatedCostUsd?: string | null;
}

/** One audit row: actor + action + entity + context. */
export interface AuditLogInput {
  /** Null for anonymous events (failed logins, blocked requests). */
  userId?: string | null;
  action: AuditAction;
  /** Entity family the action touched: `session`, `knowledge_base`, … */
  entity: string;
  entityId?: string | null;
  /** Context: before/after for settings, email/IP for logins, … */
  data?: Record<string, unknown> | null;
}

/**
 * Analytics — owns `answer_events` and `audit_logs`.
 * Exposes to other modules: the write path (`recordAnswerEvent()` /
 * `recordAuditLog()`); aggregation queries land with T-302.
 * Does NOT do: decide what is worth recording — every module records its own
 * actions through these writers.
 *
 * Both writers are **best-effort**: a failed insert is logged, never thrown.
 * Analytics/audit must not break a reply or a request that already succeeded.
 * Rows carry an indexed `created_at` — the retention key for the T-403 job
 * (NFR-7: 12-month default).
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly logger: AppLogger,
  ) {}

  /** One row per bot answer attempt — the analytics/debugging backbone. */
  async recordAnswerEvent(input: AnswerEventInput): Promise<void> {
    try {
      await this.database.db.insert(answerEvents).values({
        conversationId: input.conversationId,
        incomingMessageId: input.incomingMessageId,
        outgoingMessageId: input.outgoingMessageId ?? null,
        outcome: input.outcome,
        queryText: input.queryText,
        topK: input.topK ?? null,
        topScore: input.topScore ?? null,
        retrievedChunkIds: input.retrievedChunkIds ?? [],
        embeddingMs: input.embeddingMs ?? null,
        retrievalMs: input.retrievalMs ?? null,
        generationMs: input.generationMs ?? null,
        totalMs: input.totalMs ?? null,
        embeddingModel: input.embeddingModel ?? null,
        chatModel: input.chatModel ?? null,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        estimatedCostUsd: input.estimatedCostUsd ?? null,
      });
    } catch (error) {
      this.logger.error(
        `failed to record answer event (${input.outcome}): ${describe(error)}`,
        AnalyticsService.name,
      );
    }
  }

  /** One row per audited action. */
  async recordAuditLog(input: AuditLogInput): Promise<void> {
    try {
      await this.database.db.insert(auditLogs).values({
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        data: input.data ?? null,
      });
    } catch (error) {
      this.logger.error(
        `failed to record audit log (${input.action}): ${describe(error)}`,
        AnalyticsService.name,
      );
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
