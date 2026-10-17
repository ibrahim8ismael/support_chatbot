import type { MessageDirection, MessageSenderType } from '@support-agent/shared';
import { bigint, boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conversations } from './conversation.entity';

/**
 * `messages` — content stored as-is (private notes included).
 * `chatwoot_message_id` is the unique idempotency key for webhook dedupe.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    chatwootMessageId: bigint('chatwoot_message_id', { mode: 'number' }).notNull().unique(),
    direction: text('direction').$type<MessageDirection>().notNull(),
    senderType: text('sender_type').$type<MessageSenderType>().notNull(),
    content: text('content').notNull(),
    isPrivate: boolean('is_private').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_id_idx').on(t.conversationId)],
);
