import type { KbStatus } from '@support-agent/shared';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../auth/entities/user.entity';

/** `knowledge_bases` — a named set of documents; KBs archive by default. */
export const knowledgeBases = pgTable('knowledge_bases', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').$type<KbStatus>().notNull().default('active'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
