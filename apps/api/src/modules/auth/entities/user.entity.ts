import type { UserRole } from '@support-agent/shared';
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext } from '../../../db/columns';

/** `users` — see docs/architecture/data-model.md. Users are deactivated, never deleted. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').$type<UserRole>().notNull().default('viewer'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
