import type { AnswerOutcome } from '@support-agent/shared';
import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { conversations } from '../../conversations/entities/conversation.entity';
import { messages } from '../../conversations/entities/message.entity';

/**
 * `answer_events` — one row per bot answer attempt; the analytics and
 * debugging backbone (docs/architecture/data-model.md).
 */
export const answerEvents = pgTable(
  'answer_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** The question message. */
    incomingMessageId: uuid('incoming_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    /** The answer message, when posted. */
    outgoingMessageId: uuid('outgoing_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    outcome: text('outcome').$type<AnswerOutcome>().notNull(),
    /** The actual retrieval query (after rewrite). */
    queryText: text('query_text').notNull(),
    topK: integer('top_k'),
    /** Best similarity seen. */
    topScore: doublePrecision('top_score'),
    retrievedChunkIds: uuid('retrieved_chunk_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    embeddingMs: integer('embedding_ms'),
    retrievalMs: integer('retrieval_ms'),
    generationMs: integer('generation_ms'),
    totalMs: integer('total_ms'),
    embeddingModel: text('embedding_model'),
    chatModel: text('chat_model'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 10, scale: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('answer_events_conversation_id_idx').on(t.conversationId),
    index('answer_events_created_at_idx').on(t.createdAt),
  ],
);
