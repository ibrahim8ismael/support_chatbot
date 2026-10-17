import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * `settings` — key/value with typed accessors (module code validates values
 * on write). Secrets are never stored here — environment only.
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
