import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import type {
  BotState,
  ConversationAnswerEvent,
  ConversationDetail,
  ConversationList,
  ConversationListQuery,
  ConversationMessage,
  ConversationSummary,
  MessageDirection,
  MessageSenderType,
  ConversationChunk,
} from '@support-agent/shared';

import { DatabaseService } from '../../db/database.service';
import { conversations } from './entities/conversation.entity';
import { messages } from './entities/message.entity';

export interface UpsertConversationInput {
  chatwootAccountId: number;
  chatwootConversationId: number;
  chatwootInboxId: number;
  contactChatwootId: number;
  contactName?: string | null;
}

export interface RecordMessageInput {
  conversationId: string;
  /** Idempotency key for webhook dedupe (unique in the DB). */
  chatwootMessageId: number;
  direction: MessageDirection;
  senderType: MessageSenderType;
  content: string;
  isPrivate?: boolean;
  /** Chatwoot's creation time when available; defaults to now. */
  createdAt?: Date;
}

export interface RecentMessagesOptions {
  /** Default 8 — the context window size from message-flow.md. */
  limit?: number;
  /** Private notes are internal; excluded by default. */
  includePrivate?: boolean;
}

/**
 * Detail reads are capped (audit P2): threads and event histories grow without
 * bound, and the explorer only ever inspects the newest slice. Latest first in
 * SQL, then flipped back to chronological order for display.
 */
const DETAIL_MESSAGE_LIMIT = 500;
const DETAIL_ANSWER_EVENT_LIMIT = 200;

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

/**
 * Conversations — owns `conversations` and `messages`.
 * Exposes to other modules: conversation/message upsert & lookup, `bot_state`
 * transitions. Does NOT do: Chatwoot HTTP details (that is `chatwoot`).
 * Per-conversation locking lives in `infra` (LockService) per repo-structure.md.
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly database: DatabaseService) {}

  /** Insert-or-refresh by (account, conversation id); returns the current row. */
  async upsertConversation(input: UpsertConversationInput): Promise<Conversation> {
    const [row] = await this.database.db
      .insert(conversations)
      .values({
        chatwootAccountId: input.chatwootAccountId,
        chatwootConversationId: input.chatwootConversationId,
        chatwootInboxId: input.chatwootInboxId,
        contactChatwootId: input.contactChatwootId,
        contactName: input.contactName ?? null,
      })
      .onConflictDoUpdate({
        target: [conversations.chatwootAccountId, conversations.chatwootConversationId],
        set: {
          chatwootInboxId: input.chatwootInboxId,
          contactChatwootId: input.contactChatwootId,
          updatedAt: new Date(),
          ...(input.contactName != null ? { contactName: input.contactName } : {}),
        },
      })
      .returning();
    if (!row) {
      throw new Error('conversation upsert returned no row');
    }
    return row;
  }

  async findById(id: string): Promise<Conversation | null> {
    const [row] = await this.database.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByChatwootId(
    chatwootAccountId: number,
    chatwootConversationId: number,
  ): Promise<Conversation | null> {
    const [row] = await this.database.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.chatwootAccountId, chatwootAccountId),
          eq(conversations.chatwootConversationId, chatwootConversationId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Idempotent by `chatwoot_message_id` (`ON CONFLICT DO NOTHING`): a webhook
   * retry never produces a second row (message-flow.md step 3). Also bumps
   * `last_message_at` for genuinely new messages.
   */
  async recordMessage(input: RecordMessageInput): Promise<{ message: Message; created: boolean }> {
    const createdAt = input.createdAt ?? new Date();

    const [inserted] = await this.database.db
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        chatwootMessageId: input.chatwootMessageId,
        direction: input.direction,
        senderType: input.senderType,
        content: input.content,
        isPrivate: input.isPrivate ?? false,
        createdAt,
      })
      .onConflictDoNothing({ target: messages.chatwootMessageId })
      .returning();

    if (inserted) {
      await this.database.db
        .update(conversations)
        .set({ lastMessageAt: createdAt })
        .where(eq(conversations.id, input.conversationId));
      return { message: inserted, created: true };
    }

    const [existing] = await this.database.db
      .select()
      .from(messages)
      .where(eq(messages.chatwootMessageId, input.chatwootMessageId))
      .limit(1);
    if (!existing) {
      throw new Error(`message ${input.chatwootMessageId} vanished between writes`);
    }
    return { message: existing, created: false };
  }

  /** Oldest → newest for prompt context loading (message-flow.md step 6). */
  async recentMessages(
    conversationId: string,
    options: RecentMessagesOptions = {},
  ): Promise<Message[]> {
    const condition = options.includePrivate
      ? eq(messages.conversationId, conversationId)
      : and(eq(messages.conversationId, conversationId), eq(messages.isPrivate, false));

    const rows = await this.database.db
      .select()
      .from(messages)
      .where(condition)
      .orderBy(desc(messages.createdAt))
      .limit(options.limit ?? 8);

    return rows.reverse();
  }

  /** Pause/resume/handoff — see the transitions table in message-flow.md. */
  async setBotState(conversationId: string, state: BotState): Promise<Conversation | null> {
    const [row] = await this.database.db
      .update(conversations)
      .set({ botState: state })
      .where(eq(conversations.id, conversationId))
      .returning();
    return row ?? null;
  }

  /**
   * Conversation explorer list (rest-api.md § Conversations): all filters are
   * optional, `from`/`to` apply to `last_message_at` as a half-open range.
   */
  async listForExplorer(query: ConversationListQuery): Promise<ConversationList> {
    const { from, to } = resolveListRange(query);
    const inboxId = query.inboxId ?? null;
    const botState = query.botState ?? null;

    const rows = await this.queryRows<Record<string, unknown>>(sql`
      select
        id,
        chatwoot_conversation_id,
        chatwoot_inbox_id,
        contact_name,
        bot_state,
        last_message_at,
        created_at,
        count(*) over()::int as total
      from conversations
      where (${inboxId}::int is null or chatwoot_inbox_id = ${inboxId})
        and (${botState}::text is null or bot_state = ${botState})
        and (${from}::timestamptz is null or last_message_at >= ${from}::timestamptz)
        and (${to}::timestamptz is null or last_message_at < ${to}::timestamptz)
      order by last_message_at desc nulls last, created_at desc
      limit ${query.limit} offset ${query.offset}
    `);

    return {
      items: rows.map((row) => toConversationSummary(row)),
      total: rows.length > 0 ? toNumber(rows[0]?.total) : 0,
    };
  }

  /**
   * Conversation explorer detail: thread + (admins only) answer-attempt
   * diagnostics with the cited chunks. Answer events carry customer query
   * text, which security.md § 4 limits to admins.
   */
  async detailForExplorer(
    id: string,
    options: { includeAnswerEvents: boolean },
  ): Promise<ConversationDetail> {
    const [conversationRow] = await this.queryRows<Record<string, unknown>>(sql`
      select
        id,
        chatwoot_conversation_id,
        chatwoot_inbox_id,
        contact_name,
        bot_state,
        last_message_at,
        created_at
      from conversations
      where id = ${id}::uuid
    `);
    if (!conversationRow) {
      throw new NotFoundException(`conversation ${id} not found`);
    }

    const messageRows = await this.queryRows<Record<string, unknown>>(sql`
      select id, direction, sender_type, content, is_private, created_at
      from messages
      where conversation_id = ${id}::uuid
      order by created_at desc, chatwoot_message_id desc
      limit ${DETAIL_MESSAGE_LIMIT}
    `);

    let answerEvents: ConversationAnswerEvent[] = [];
    if (options.includeAnswerEvents) {
      const eventRows = await this.queryRows<Record<string, unknown>>(sql`
        select
          id,
          outcome,
          query_text,
          top_k,
          top_score,
          retrieved_chunk_ids,
          embedding_ms,
          retrieval_ms,
          generation_ms,
          total_ms,
          embedding_model,
          chat_model,
          tokens_in,
          tokens_out,
          estimated_cost_usd,
          created_at
        from answer_events
        where conversation_id = ${id}::uuid
        order by created_at desc
        limit ${DETAIL_ANSWER_EVENT_LIMIT}
      `);

      const chunkIds = [
        ...new Set(eventRows.flatMap((row) => (row.retrieved_chunk_ids as string[] | null) ?? [])),
      ];
      const chunkRows =
        chunkIds.length === 0
          ? []
          : await this.queryRows<Record<string, unknown>>(sql`
              select c.id, c.document_id, c.chunk_index, c.content, d.filename
              from chunks c
              left join documents d on d.id = c.document_id
              where c.id in (${sql.join(
                chunkIds.map((chunkId) => sql`${chunkId}::uuid`),
                sql`, `,
              )})
            `);
      const chunksById = new Map(
        chunkRows.map((row) => [String(row.id), toConversationChunk(row)] as const),
      );
      answerEvents = [...eventRows].reverse().map((row) => toAnswerEvent(row, chunksById));
    }

    return {
      conversation: toConversationSummary(conversationRow),
      messages: [...messageRows].reverse().map((row) => toMessage(row)),
      answerEvents,
      answerEventsRestricted: !options.includeAnswerEvents,
    };
  }

  /** Raw-SQL helper — driver rows come back untyped (see AnalyticsService). */
  private async queryRows<T>(query: SQL): Promise<T[]> {
    const rows = await this.database.db.execute(query);
    return rows as unknown as T[];
  }
}

/**
 * `from`/`to` are bound as ISO strings with explicit casts: under drizzle the
 * postgres-js driver's date serializers are identity functions, so raw `Date`
 * params crash it (same reason as AnalyticsService).
 */
function resolveListRange(query: ConversationListQuery): {
  from: string | null;
  to: string | null;
} {
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if (from && to && from.getTime() >= to.getTime()) {
    throw new BadRequestException('from must be before to');
  }
  return { from: from ? from.toISOString() : null, to: to ? to.toISOString() : null };
}

function toIso(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: unknown): number {
  return toNullableNumber(value) ?? 0;
}

function toConversationSummary(row: Record<string, unknown>): ConversationSummary {
  return {
    id: String(row.id),
    chatwootConversationId: toNumber(row.chatwoot_conversation_id),
    chatwootInboxId: toNumber(row.chatwoot_inbox_id),
    contactName: (row.contact_name as string | null) ?? null,
    botState: row.bot_state as ConversationSummary['botState'],
    lastMessageAt: toIso(row.last_message_at),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

function toMessage(row: Record<string, unknown>): ConversationMessage {
  return {
    id: String(row.id),
    direction: row.direction as ConversationMessage['direction'],
    senderType: row.sender_type as ConversationMessage['senderType'],
    content: String(row.content),
    isPrivate: Boolean(row.is_private),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

function toConversationChunk(row: Record<string, unknown>): ConversationChunk {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    documentFilename: (row.filename as string | null) ?? null,
    chunkIndex: toNumber(row.chunk_index),
    content: String(row.content),
  };
}

function toAnswerEvent(
  row: Record<string, unknown>,
  chunksById: Map<string, ConversationChunk>,
): ConversationAnswerEvent {
  const chunkIds = (row.retrieved_chunk_ids as string[] | null) ?? [];
  return {
    id: String(row.id),
    outcome: row.outcome as ConversationAnswerEvent['outcome'],
    queryText: String(row.query_text),
    topK: toNullableNumber(row.top_k),
    topScore: toNullableNumber(row.top_score),
    // Keep retrieval-rank order; ids without a live chunk row are dropped.
    retrievedChunks: chunkIds
      .map((chunkId) => chunksById.get(chunkId))
      .filter((chunk): chunk is ConversationChunk => chunk !== undefined),
    embeddingMs: toNullableNumber(row.embedding_ms),
    retrievalMs: toNullableNumber(row.retrieval_ms),
    generationMs: toNullableNumber(row.generation_ms),
    totalMs: toNullableNumber(row.total_ms),
    embeddingModel: (row.embedding_model as string | null) ?? null,
    chatModel: (row.chat_model as string | null) ?? null,
    tokensIn: toNullableNumber(row.tokens_in),
    tokensOut: toNullableNumber(row.tokens_out),
    estimatedCostUsd: toNullableNumber(row.estimated_cost_usd),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}
