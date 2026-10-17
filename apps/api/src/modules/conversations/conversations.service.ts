import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import type { BotState, MessageDirection, MessageSenderType } from '@support-agent/shared';

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
}
