import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { PlaygroundTurn, SandboxExpectedBehavior } from '@support-agent/shared';

import { users } from '../../auth/entities/user.entity';

/**
 * `sandbox_cases` — saved accuracy questions with their expected outcome.
 * A run snapshots these fields into `sandbox_results`, so editing or deleting a
 * case never rewrites history (docs/product/sandbox.md).
 */
export const sandboxCases = pgTable(
  'sandbox_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    question: text('question').notNull(),
    kbIds: uuid('kb_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    history: jsonb('history')
      .$type<PlaygroundTurn[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    expectedBehavior: text('expected_behavior')
      .$type<SandboxExpectedBehavior>()
      .notNull()
      .default('answer'),
    expectedFilenames: text('expected_filenames')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    requiredPhrases: text('required_phrases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    forbiddenPhrases: text('forbidden_phrases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    referenceAnswer: text('reference_answer'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text('notes'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('sandbox_cases_updated_at_idx').on(t.updatedAt)],
);
