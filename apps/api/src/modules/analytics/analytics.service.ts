import { BadRequestException, Injectable } from '@nestjs/common';
import { desc, eq, sql, type SQL } from 'drizzle-orm';

import {
  type AnalyticsInterval,
  type AnalyticsOverview,
  type AnalyticsQuery,
  type AnalyticsTimeseries,
  type AnalyticsTimeseriesQuery,
  type AnalyticsUnansweredQuery,
  type AnswerOutcome,
  type AuditLogEntry,
  type AuditLogList,
  type AuditLogQuery,
  type UnansweredQuestion,
} from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { DatabaseService } from '../../db/database.service';
import { answerEvents } from './entities/answer-event.entity';
import { auditLogs } from './entities/audit-log.entity';
import { clusterUnanswered } from './unanswered';

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
  'users.create',
  'users.update',
  'users.password_reset',
  'sandbox.case.create',
  'sandbox.case.update',
  'sandbox.case.delete',
  'sandbox.run.start',
  'sandbox.run.cancel',
  'sandbox.run.retry',
  'sandbox.result.review',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Escalation outcomes — "the bot could not (or should not) answer" (FR-6). */
export const ESCALATION_OUTCOMES: readonly AnswerOutcome[] = [
  'escalated_low_score',
  'escalated_guard',
  'escalated_request',
  'escalated_classifier',
  'escalated_repeat',
];

/** Defaults + limits for the read endpoints (rest-api.md § Analytics). */
const DEFAULT_RANGE_DAYS = 7;
/** Hard window cap: unbounded ranges drive `generate_series` + full scans. */
const MAX_RANGE_DAYS = 366;
/** Escalation rows scanned for the unanswered list before clustering. */
const UNANSWERED_SCAN_LIMIT = 500;

export interface AnalyticsFilters {
  from: Date;
  to: Date;
  inboxId?: number;
}

/**
 * `($1, …, $5)` over ESCALATION_OUTCOMES for `outcome in …`. Rendered via
 * `sql.join` — drizzle expands a JS array passed straight into a `sql`
 * template into a record, which `any()` rejects.
 */
function escalationOutcomeList(): SQL {
  return sql`(${sql.join(
    ESCALATION_OUTCOMES.map((outcome) => sql`${outcome}`),
    sql`, `,
  )})`;
}

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
 * `recordAuditLog()`), used by agent/auth/KB/bindings/settings, and the read
 * path (`overview()` / `timeseries()` / `unanswered()` — T-302).
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

  /** Latest bot attempt for a message, used to avoid duplicate webhook replies. */
  async findAnswerEventForIncomingMessage(incomingMessageId: string): Promise<{
    id: string;
    outgoingMessageId: string | null;
    outcome: AnswerOutcome;
  } | null> {
    const [row] = await this.database.db
      .select({
        id: answerEvents.id,
        outgoingMessageId: answerEvents.outgoingMessageId,
        outcome: answerEvents.outcome,
      })
      .from(answerEvents)
      .where(eq(answerEvents.incomingMessageId, incomingMessageId))
      .orderBy(desc(answerEvents.createdAt))
      .limit(1);
    return row ?? null;
  }

  /** Attach the Chatwoot reply after it has been posted successfully. */
  async attachOutgoingMessage(answerEventId: string, outgoingMessageId: string): Promise<void> {
    try {
      await this.database.db
        .update(answerEvents)
        .set({ outgoingMessageId })
        .where(eq(answerEvents.id, answerEventId));
    } catch (error) {
      this.logger.error(
        `could not attach outgoing message to answer event: ${String(error)}`,
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

  /**
   * Admin audit-log page (rest-api.md § Audit log): newest first, all filters
   * optional (`from`/`to` half-open on `created_at`), window total for paging.
   */
  async listAuditLogs(query: AuditLogQuery): Promise<AuditLogList> {
    const { from, to } = resolveAuditRange(query);
    const userId = query.userId ?? null;
    const action = query.action ?? null;

    const rows = await this.queryRows<Record<string, unknown>>(sql`
      select
        a.id,
        a.user_id,
        u.email as user_email,
        a.action,
        a.entity,
        a.entity_id,
        a.data,
        a.created_at,
        count(*) over()::int as total
      from audit_logs a
      left join users u on u.id = a.user_id
      where (${userId}::uuid is null or a.user_id = ${userId}::uuid)
        and (${action}::text is null or a.action = ${action})
        and (${from}::timestamptz is null or a.created_at >= ${from}::timestamptz)
        and (${to}::timestamptz is null or a.created_at < ${to}::timestamptz)
      order by a.created_at desc, a.id desc
      limit ${query.limit} offset ${query.offset}
    `);

    return {
      items: rows.map((row) => toAuditLogEntry(row)),
      total: rows.length > 0 ? toNumber(rows[0]?.total) : 0,
    };
  }

  /**
   * Dashboard snapshot for a range — the metric definitions in
   * docs/api/rest-api.md are the contract (do not silently change).
   * `conversations`: distinct conversations with ≥ 1 incoming message in
   * range; `botAnswered`: those with ≥ 1 `answered` event in range and no
   * human-agent message within 24 h after it; latency is over all
   * `answered` events in range; ranges are [from, to).
   */
  async overview(query: AnalyticsQuery): Promise<AnalyticsOverview> {
    const filters = resolveFilters(query);
    const inboxId = filters.inboxId ?? null;
    // The postgres-js driver's date serializers are identity functions in
    // drizzle (it expects strings) — bind ISO strings with an explicit cast.
    const from = filters.from.toISOString();
    const to = filters.to.toISOString();

    const [row = {}] = await this.queryRows<Record<string, unknown>>(sql`
      with base_conversations as (
        select c.id
        from conversations c
        where exists (
          select 1
          from messages m
          where m.conversation_id = c.id
            and m.direction = 'incoming'
            and m.created_at >= ${from}::timestamptz
            and m.created_at < ${to}::timestamptz
        )
        and (${inboxId}::int is null or c.chatwoot_inbox_id = ${inboxId})
      ),
      answered as (
        select
          e.conversation_id,
          e.total_ms,
          (
            not exists (
              select 1
              from messages h
              where h.conversation_id = e.conversation_id
                and h.sender_type = 'human_agent'
                and h.created_at > e.created_at
                and h.created_at <= e.created_at + interval '24 hours'
            )
          ) as deflected
        from answer_events e
        join base_conversations b on b.id = e.conversation_id
        where e.outcome = 'answered'
          and e.created_at >= ${from}::timestamptz
          and e.created_at < ${to}::timestamptz
      ),
      escalations as (
        select distinct e.conversation_id
        from answer_events e
        join base_conversations b on b.id = e.conversation_id
        where e.outcome in ${escalationOutcomeList()}
          and e.created_at >= ${from}::timestamptz
          and e.created_at < ${to}::timestamptz
      )
      select
        (select count(*)::int from base_conversations) as conversations,
        (select (count(distinct conversation_id) filter (where deflected))::int from answered) as bot_answered,
        (select count(*)::int from escalations) as escalated_conversations,
        (select coalesce(avg(total_ms), 0)::float8 from answered) as avg_latency_ms,
        (
          select coalesce(percentile_cont(0.95) within group (order by total_ms), 0)::float8
          from answered
        ) as p95_latency_ms,
        (
          select coalesce(sum(e.tokens_in), 0)::int
          from answer_events e
          where e.created_at >= ${from}::timestamptz
            and e.created_at < ${to}::timestamptz
            and (${inboxId}::int is null or exists (
              select 1 from conversations c
              where c.id = e.conversation_id and c.chatwoot_inbox_id = ${inboxId}
            ))
        ) as tokens_in,
        (
          select coalesce(sum(e.tokens_out), 0)::int
          from answer_events e
          where e.created_at >= ${from}::timestamptz
            and e.created_at < ${to}::timestamptz
            and (${inboxId}::int is null or exists (
              select 1 from conversations c
              where c.id = e.conversation_id and c.chatwoot_inbox_id = ${inboxId}
            ))
        ) as tokens_out,
        (
          select coalesce(sum(e.estimated_cost_usd), 0)::float8
          from answer_events e
          where e.created_at >= ${from}::timestamptz
            and e.created_at < ${to}::timestamptz
            and (${inboxId}::int is null or exists (
              select 1 from conversations c
              where c.id = e.conversation_id and c.chatwoot_inbox_id = ${inboxId}
            ))
        ) as estimated_cost_usd
    `);

    return toOverview(row);
  }

  /**
   * Per-bucket numbers for charts (rest-api.md § Analytics). Buckets are UTC
   * and gap-free (`generate_series`); `conversations` counts a conversation in
   * the bucket of its first incoming message in range, event metrics count
   * activity per bucket (a conversation may appear in several buckets).
   */
  async timeseries(query: AnalyticsTimeseriesQuery): Promise<AnalyticsTimeseries> {
    const filters = resolveFilters(query);
    const interval: AnalyticsInterval = query.interval;
    const inboxId = filters.inboxId ?? null;
    // The postgres-js driver's date serializers are identity functions in
    // drizzle (it expects strings) — bind ISO strings with an explicit cast.
    const from = filters.from.toISOString();
    const to = filters.to.toISOString();

    const rows = await this.queryRows<Record<string, unknown>>(sql`
      with buckets as (
        select generate_series(
          date_trunc(${interval}, ${from}::timestamptz),
          date_trunc(${interval}, ${to}::timestamptz),
          ('1 ' || ${interval})::interval
        ) as bucket
      ),
      first_messages as (
        select c.id, min(m.created_at) as first_at
        from conversations c
        join messages m on m.conversation_id = c.id
        where m.direction = 'incoming'
          and m.created_at >= ${from}::timestamptz
          and m.created_at < ${to}::timestamptz
          and (${inboxId}::int is null or c.chatwoot_inbox_id = ${inboxId})
        group by c.id
      ),
      conversations_per_bucket as (
        select date_trunc(${interval}, first_at) as bucket, count(*)::int as conversations
        from first_messages
        group by 1
      ),
      events as (
        select
          e.created_at,
          e.conversation_id,
          e.outcome,
          e.total_ms,
          e.tokens_in,
          e.tokens_out,
          e.estimated_cost_usd,
          (
            e.outcome = 'answered'
            and not exists (
              select 1
              from messages h
              where h.conversation_id = e.conversation_id
                and h.sender_type = 'human_agent'
                and h.created_at > e.created_at
                and h.created_at <= e.created_at + interval '24 hours'
            )
          ) as deflected
        from answer_events e
        where e.created_at >= ${from}::timestamptz
          and e.created_at < ${to}::timestamptz
          and (${inboxId}::int is null or exists (
            select 1 from conversations c
            where c.id = e.conversation_id and c.chatwoot_inbox_id = ${inboxId}
          ))
      ),
      metrics as (
        select
          date_trunc(${interval}, created_at) as bucket,
          (count(distinct conversation_id) filter (where deflected))::int as bot_answered,
          (
            count(distinct conversation_id)
            filter (where outcome in ${escalationOutcomeList()})
          )::int as escalated_conversations,
          coalesce(avg(total_ms) filter (where outcome = 'answered'), 0)::float8 as avg_latency_ms,
          coalesce(
            percentile_cont(0.95) within group (order by total_ms)
            filter (where outcome = 'answered'),
            0
          )::float8 as p95_latency_ms,
          coalesce(sum(tokens_in), 0)::int as tokens_in,
          coalesce(sum(tokens_out), 0)::int as tokens_out,
          coalesce(sum(estimated_cost_usd), 0)::float8 as estimated_cost_usd
        from events
        group by 1
      )
      select
        b.bucket,
        coalesce(c.conversations, 0)::int as conversations,
        coalesce(m.bot_answered, 0)::int as bot_answered,
        coalesce(m.escalated_conversations, 0)::int as escalated_conversations,
        coalesce(m.avg_latency_ms, 0)::float8 as avg_latency_ms,
        coalesce(m.p95_latency_ms, 0)::float8 as p95_latency_ms,
        coalesce(m.tokens_in, 0)::int as tokens_in,
        coalesce(m.tokens_out, 0)::int as tokens_out,
        coalesce(m.estimated_cost_usd, 0)::float8 as estimated_cost_usd
      from buckets b
      left join conversations_per_bucket c on c.bucket = b.bucket
      left join metrics m on m.bucket = b.bucket
      order by b.bucket
    `);

    return {
      interval,
      from: filters.from.toISOString(),
      to: filters.to.toISOString(),
      points: rows.map((row) => ({
        bucket: new Date(row.bucket as string | Date).toISOString(),
        ...toOverview(row),
      })),
    };
  }

  /**
   * Top unanswered questions (FR-7): escalation events in range, clustered by
   * token similarity (unanswered.ts), newest first before clustering so ties
   * resolve predictably. Exposes customer text — admin-only at the edge.
   */
  async unanswered(query: AnalyticsUnansweredQuery): Promise<UnansweredQuestion[]> {
    const filters = resolveFilters(query);
    const inboxId = filters.inboxId ?? null;
    // The postgres-js driver's date serializers are identity functions in
    // drizzle (it expects strings) — bind ISO strings with an explicit cast.
    const from = filters.from.toISOString();
    const to = filters.to.toISOString();

    const rows = await this.queryRows<{
      query_text: string;
      created_at: string | Date;
      conversation_id: string;
    }>(sql`
      select e.query_text, e.created_at, e.conversation_id
      from answer_events e
      where e.outcome in ${escalationOutcomeList()}
        and e.created_at >= ${from}::timestamptz
        and e.created_at < ${to}::timestamptz
        and (${inboxId}::int is null or exists (
          select 1 from conversations c
          where c.id = e.conversation_id and c.chatwoot_inbox_id = ${inboxId}
        ))
      order by e.created_at desc
      limit ${UNANSWERED_SCAN_LIMIT}
    `);

    return clusterUnanswered(
      rows.map((row) => ({
        queryText: row.query_text,
        createdAt: new Date(row.created_at),
        conversationId: row.conversation_id,
      })),
      query.limit,
    );
  }

  /** Raw-SQL rows for the aggregate endpoints (postgres.js RowList). */
  private async queryRows<T>(query: SQL): Promise<T[]> {
    const rows = await this.database.db.execute(query);
    return rows as unknown as T[];
  }
}

function resolveFilters(query: AnalyticsQuery): AnalyticsFilters {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
  if (!(from.getTime() < to.getTime())) {
    throw new BadRequestException('`from` must be before `to`');
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    throw new BadRequestException(`range too large — at most ${MAX_RANGE_DAYS} days`);
  }
  return { from, to, inboxId: query.inboxId };
}

function toOverview(row: Record<string, unknown>): AnalyticsOverview {
  const conversations = toNumber(row.conversations);
  const botAnswered = toNumber(row.bot_answered);
  return {
    conversations,
    botAnswered,
    deflectionRate: conversations === 0 ? 0 : botAnswered / conversations,
    escalationRate: conversations === 0 ? 0 : toNumber(row.escalated_conversations) / conversations,
    avgLatencyMs: toNumber(row.avg_latency_ms),
    p95LatencyMs: toNumber(row.p95_latency_ms),
    tokensIn: toNumber(row.tokens_in),
    tokensOut: toNumber(row.tokens_out),
    estimatedCostUsd: toNumber(row.estimated_cost_usd),
  };
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Timestamps come back as `Date` from postgres-js; the API speaks ISO strings. */
function toIso(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function toAuditLogEntry(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: String(row.id),
    userId: (row.user_id as string | null) ?? null,
    userEmail: (row.user_email as string | null) ?? null,
    action: String(row.action),
    entity: String(row.entity),
    entityId: (row.entity_id as string | null) ?? null,
    data: row.data ?? null,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

function resolveAuditRange(query: AuditLogQuery): { from: string | null; to: string | null } {
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if (from && to && from.getTime() >= to.getTime()) {
    throw new BadRequestException('from must be before to');
  }
  return { from: from ? from.toISOString() : null, to: to ? to.toISOString() : null };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
