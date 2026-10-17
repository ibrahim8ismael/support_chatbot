import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `inbox_bindings` — which Chatwoot inboxes the bot serves and from which
 * KBs. Empty `kb_ids` (or `enabled = false`) means the bot is off there.
 */
export const inboxBindings = pgTable('inbox_bindings', {
  id: uuid('id').primaryKey().defaultRandom(),
  chatwootAccountId: integer('chatwoot_account_id').notNull(),
  chatwootInboxId: integer('chatwoot_inbox_id').notNull().unique(),
  kbIds: uuid('kb_ids')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  enabled: boolean('enabled').notNull().default(true),
  /** Inbox name cached from Chatwoot for the UI. */
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
