import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.entity';

/**
 * `sessions` — server-side auth sessions; the row id is the httpOnly cookie
 * value. `expires_at` slides on activity (7 days default).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);
