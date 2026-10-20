import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import type { SandboxMetrics, SandboxRunStatus, Settings } from '@support-agent/shared';

import { users } from '../../auth/entities/user.entity';

/**
 * `sandbox_runs` — one batch execution. `settings_snapshot` + `prompt_version`
 * make a result explainable after settings or prompts change.
 */
export const sandboxRuns = pgTable(
  'sandbox_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    status: text('status').$type<SandboxRunStatus>().notNull().default('queued'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    caseCount: integer('case_count').notNull(),
    completedCount: integer('completed_count').notNull().default(0),
    kbIds: uuid('kb_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    caseIds: uuid('case_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    settingsSnapshot: jsonb('settings_snapshot').$type<Settings>().notNull(),
    promptVersion: text('prompt_version').notNull(),
    provider: text('provider').notNull(),
    metrics: jsonb('metrics').$type<SandboxMetrics>(),
    totalTokensIn: integer('total_tokens_in').notNull().default(0),
    totalTokensOut: integer('total_tokens_out').notNull().default(0),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 10, scale: 6 }),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sandbox_runs_created_at_idx').on(t.createdAt),
    index('sandbox_runs_status_idx').on(t.status),
  ],
);
