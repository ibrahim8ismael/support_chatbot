import { z } from 'zod';
import {
  ANSWER_OUTCOMES,
  BOT_STATES,
  MESSAGE_DIRECTIONS,
  MESSAGE_SENDER_TYPES,
} from '../types/domain';

/**
 * Conversation explorer query params + response shapes (rest-api.md
 * § Conversations). The API controller/UI share these so filters can't drift.
 */

/** `GET /conversations` — all filters optional (no range = all conversations). */
export const conversationListQuerySchema = z.strictObject({
  /** Chatwoot inbox id. */
  inboxId: z.coerce.number().int().positive().optional(),
  botState: z.enum(BOT_STATES).optional(),
  /** Filters on `last_message_at` (half-open `[from, to)` when both given). */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

/** One row of the explorer list. */
export interface ConversationSummary {
  id: string;
  chatwootConversationId: number;
  chatwootInboxId: number;
  contactName: string | null;
  botState: (typeof BOT_STATES)[number];
  lastMessageAt: string | null;
  createdAt: string;
}

export interface ConversationList {
  items: ConversationSummary[];
  /** Total matching conversations (before limit/offset). */
  total: number;
}

export interface ConversationMessage {
  id: string;
  direction: (typeof MESSAGE_DIRECTIONS)[number];
  senderType: (typeof MESSAGE_SENDER_TYPES)[number];
  content: string;
  /** Chatwoot private notes (e.g. escalation handoffs) — internal. */
  isPrivate: boolean;
  createdAt: string;
}

/** A chunk cited by an answer event, in retrieval-rank order. */
export interface ConversationChunk {
  id: string;
  documentId: string;
  documentFilename: string | null;
  chunkIndex: number;
  content: string;
}

/**
 * Answer-attempt diagnostics. `queryText` is customer text, so the whole
 * array is admin-only (security.md § 4) — see `answerEventsRestricted`.
 */
export interface ConversationAnswerEvent {
  id: string;
  outcome: (typeof ANSWER_OUTCOMES)[number];
  queryText: string;
  topK: number | null;
  /** Best similarity seen (per-chunk scores are not persisted). */
  topScore: number | null;
  retrievedChunks: ConversationChunk[];
  embeddingMs: number | null;
  retrievalMs: number | null;
  generationMs: number | null;
  totalMs: number | null;
  embeddingModel: string | null;
  chatModel: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  estimatedCostUsd: number | null;
  createdAt: string;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  /** Oldest → newest, private notes included and flagged. */
  messages: ConversationMessage[];
  /** Empty for non-admins; `answerEventsRestricted` is then true. */
  answerEvents: ConversationAnswerEvent[];
  answerEventsRestricted: boolean;
}
