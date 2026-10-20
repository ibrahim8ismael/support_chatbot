import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  AgentChunk,
  AgentLatency,
  AgentTokens,
  PlaygroundTurn,
  SandboxExpectedBehavior,
  SandboxResultChecks,
  SandboxResultStatus,
  SandboxReviewStatus,
} from '@support-agent/shared';

import { users } from '../../auth/entities/user.entity';
import { sandboxCases } from './sandbox-case.entity';
import { sandboxRuns } from './sandbox-run.entity';

/**
 * `sandbox_results` — one snapshot per case in a run. Rows are created as
 * `pending`; the worker fills in the answer and checks. The unique
 * (run, case) pair makes retries idempotent.
 */
export const sandboxResults = pgTable(
  'sandbox_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => sandboxRuns.id, { onDelete: 'cascade' }),
    /** Null after the case is deleted; the snapshot below still renders. */
    caseId: uuid('case_id').references(() => sandboxCases.id, { onDelete: 'set null' }),
    caseName: text('case_name').notNull(),
    question: text('question').notNull(),
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
    /** Stable order inside the run (0-based). */
    position: integer('position').notNull(),
    status: text('status').$type<SandboxResultStatus>().notNull().default('pending'),
    answer: text('answer').notNull().default(''),
    escalated: boolean('escalated').notNull().default(false),
    escalationReason: text('escalation_reason'),
    chunks: jsonb('chunks')
      .$type<AgentChunk[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    bestScore: doublePrecision('best_score'),
    passed: boolean('passed').notNull().default(false),
    checks: jsonb('checks')
      .$type<SandboxResultChecks>()
      .notNull()
      .default(
        sql`'{"behaviorOk":null,"retrievalHit":null,"requiredOk":null,"forbiddenOk":null}'::jsonb`,
      ),
    requiredHits: text('required_hits')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    forbiddenHits: text('forbidden_hits')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    latency: jsonb('latency')
      .$type<AgentLatency>()
      .notNull()
      .default(sql`'{"retrievalMs":0,"generationMs":0,"totalMs":0}'::jsonb`),
    tokens: jsonb('tokens')
      .$type<AgentTokens>()
      .notNull()
      .default(sql`'{"input":0,"output":0}'::jsonb`),
    model: text('model'),
    promptVersion: text('prompt_version').notNull(),
    error: text('error'),
    reviewStatus: text('review_status')
      .$type<SandboxReviewStatus>()
      .notNull()
      .default('unreviewed'),
    reviewNote: text('review_note'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sandbox_results_run_case_uidx').on(t.runId, t.caseId),
    index('sandbox_results_run_id_idx').on(t.runId),
    index('sandbox_results_review_status_idx').on(t.reviewStatus),
  ],
);
