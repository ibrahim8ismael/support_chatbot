import type { BotState } from '@support-agent/shared';
import { bigint, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * `conversations` — our mirror of a Chatwoot conversation. `bot_state` is our
 * view of "may the bot reply" (active | paused | handed_off).
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatwootAccountId: integer('chatwoot_account_id').notNull(),
    chatwootConversationId: bigint('chatwoot_conversation_id', { mode: 'number' }).notNull(),
    chatwootInboxId: integer('chatwoot_inbox_id').notNull(),
    contactChatwootId: bigint('contact_chatwoot_id', { mode: 'number' }).notNull(),
    /** Cached for the UI. */
    contactName: text('contact_name'),
    botState: text('bot_state').$type<BotState>().notNull().default('active'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('conversations_account_conversation_uidx').on(
      t.chatwootAccountId,
      t.chatwootConversationId,
    ),
  ],
);
