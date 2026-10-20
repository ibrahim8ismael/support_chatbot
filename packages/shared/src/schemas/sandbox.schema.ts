import { z } from 'zod';

import { playgroundTurnSchema } from './playground.schema';

/**
 * Sandbox contracts (docs/product/sandbox.md): saved accuracy cases and the
 * scored batch runs that execute them through the real answer path.
 *
 * A run is a snapshot. Results copy the question and expectations at creation
 * time, so editing a case later never rewrites history.
 */

export const SANDBOX_EXPECTED_BEHAVIORS = ['answer', 'escalate', 'either'] as const;
export type SandboxExpectedBehavior = (typeof SANDBOX_EXPECTED_BEHAVIORS)[number];

export const SANDBOX_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type SandboxRunStatus = (typeof SANDBOX_RUN_STATUSES)[number];

export const SANDBOX_RESULT_STATUSES = ['pending', 'completed', 'error'] as const;
export type SandboxResultStatus = (typeof SANDBOX_RESULT_STATUSES)[number];

export const SANDBOX_REVIEW_STATUSES = ['unreviewed', 'pass', 'fail'] as const;
export type SandboxReviewStatus = (typeof SANDBOX_REVIEW_STATUSES)[number];

/** Limits shared by the API and the dashboard (rest-api.md § Sandbox). */
export const SANDBOX_MAX_CASES_PER_RUN = 100;
export const SANDBOX_MAX_RUNS_PER_DAY = 10;
export const SANDBOX_MAX_KB_SELECTION = 10;

const phraseSchema = z.string().trim().min(1).max(200);
const filenameSchema = z.string().trim().min(1).max(500);
const tagSchema = z.string().trim().min(1).max(40);

/** Fields a case can be created with; the API applies defaults. */
const caseFields = {
  name: z.string().trim().min(1).max(200),
  question: z.string().trim().min(3).max(2_000),
  kbIds: z.array(z.uuid()).min(1).max(SANDBOX_MAX_KB_SELECTION),
  history: z.array(playgroundTurnSchema).max(20),
  expectedBehavior: z.enum(SANDBOX_EXPECTED_BEHAVIORS),
  expectedFilenames: z.array(filenameSchema).max(20),
  requiredPhrases: z.array(phraseSchema).max(20),
  forbiddenPhrases: z.array(phraseSchema).max(20),
  referenceAnswer: z.string().trim().max(5_000).nullable(),
  tags: z.array(tagSchema).max(20),
  notes: z.string().trim().max(2_000).nullable(),
  isEnabled: z.boolean(),
};

/** `POST /sandbox/cases` — omitted optional fields fall back to safe defaults. */
export const sandboxCaseInputSchema = z.strictObject({
  ...caseFields,
  name: caseFields.name.optional(),
  history: caseFields.history.optional(),
  expectedBehavior: caseFields.expectedBehavior.default('answer'),
  expectedFilenames: caseFields.expectedFilenames.optional(),
  requiredPhrases: caseFields.requiredPhrases.optional(),
  forbiddenPhrases: caseFields.forbiddenPhrases.optional(),
  referenceAnswer: caseFields.referenceAnswer.optional(),
  tags: caseFields.tags.optional(),
  notes: caseFields.notes.optional(),
  isEnabled: caseFields.isEnabled.optional(),
});

export type SandboxCaseInput = z.infer<typeof sandboxCaseInputSchema>;

/** `PATCH /sandbox/cases/:id` — partial, at least one field. */
export const sandboxCaseUpdateSchema = z
  .strictObject(caseFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'provide at least one field',
  });

export type SandboxCaseUpdate = z.infer<typeof sandboxCaseUpdateSchema>;

export const sandboxCaseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  question: z.string(),
  kbIds: z.array(z.uuid()),
  history: z.array(playgroundTurnSchema),
  expectedBehavior: z.enum(SANDBOX_EXPECTED_BEHAVIORS),
  expectedFilenames: z.array(z.string()),
  requiredPhrases: z.array(z.string()),
  forbiddenPhrases: z.array(z.string()),
  referenceAnswer: z.string().nullable(),
  tags: z.array(z.string()),
  notes: z.string().nullable(),
  isEnabled: z.boolean(),
  createdBy: z.uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SandboxCase = z.infer<typeof sandboxCaseSchema>;

/** `POST /sandbox/runs` — omitted `caseIds` means every enabled case. */
export const sandboxRunInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  kbIds: z.array(z.uuid()).min(1).max(SANDBOX_MAX_KB_SELECTION),
  caseIds: z.array(z.uuid()).min(1).max(SANDBOX_MAX_CASES_PER_RUN).optional(),
});

export type SandboxRunInput = z.infer<typeof sandboxRunInputSchema>;

export const sandboxMetricSchema = z.object({
  passed: z.number().int(),
  total: z.number().int(),
  /** null = no applicable cases. */
  rate: z.number().nullable(),
});

export type SandboxMetric = z.infer<typeof sandboxMetricSchema>;

export const sandboxMetricsSchema = z.object({
  cases: z.number().int(),
  autoPass: sandboxMetricSchema,
  behavior: sandboxMetricSchema,
  retrievalHit: sandboxMetricSchema,
  requiredPhrases: sandboxMetricSchema,
  forbiddenPhrases: sandboxMetricSchema,
  verified: sandboxMetricSchema,
  errored: z.array(z.string()),
});

export type SandboxMetrics = z.infer<typeof sandboxMetricsSchema>;

export const sandboxRunSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(SANDBOX_RUN_STATUSES),
  caseCount: z.number().int(),
  completedCount: z.number().int(),
  kbIds: z.array(z.uuid()),
  caseIds: z.array(z.uuid()),
  settingsSnapshot: z.record(z.string(), z.unknown()),
  promptVersion: z.string(),
  provider: z.string(),
  metrics: sandboxMetricsSchema.nullable(),
  totalTokensIn: z.number().int(),
  totalTokensOut: z.number().int(),
  estimatedCostUsd: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type SandboxRun = z.infer<typeof sandboxRunSchema>;

export const sandboxChunkSchema = z.object({
  id: z.string(),
  score: z.number(),
  content: z.string(),
  document: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export const sandboxResultChecksSchema = z.object({
  behaviorOk: z.boolean().nullable(),
  retrievalHit: z.boolean().nullable(),
  requiredOk: z.boolean().nullable(),
  forbiddenOk: z.boolean().nullable(),
});

export type SandboxResultChecks = z.infer<typeof sandboxResultChecksSchema>;

export const sandboxResultSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  caseId: z.uuid().nullable(),
  caseName: z.string(),
  question: z.string(),
  history: z.array(playgroundTurnSchema),
  expectedBehavior: z.enum(SANDBOX_EXPECTED_BEHAVIORS),
  expectedFilenames: z.array(z.string()),
  requiredPhrases: z.array(z.string()),
  forbiddenPhrases: z.array(z.string()),
  referenceAnswer: z.string().nullable(),
  position: z.number().int(),
  status: z.enum(SANDBOX_RESULT_STATUSES),
  answer: z.string(),
  escalated: z.boolean(),
  escalationReason: z.string().nullable(),
  chunks: z.array(sandboxChunkSchema),
  bestScore: z.number().nullable(),
  passed: z.boolean(),
  checks: sandboxResultChecksSchema,
  requiredHits: z.array(z.string()),
  forbiddenHits: z.array(z.string()),
  latency: z.object({
    retrievalMs: z.number().int(),
    generationMs: z.number().int(),
    totalMs: z.number().int(),
  }),
  tokens: z.object({
    input: z.number().int(),
    output: z.number().int(),
  }),
  model: z.string().nullable(),
  promptVersion: z.string(),
  error: z.string().nullable(),
  reviewStatus: z.enum(SANDBOX_REVIEW_STATUSES),
  reviewNote: z.string().nullable(),
  reviewedBy: z.uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type SandboxResult = z.infer<typeof sandboxResultSchema>;

/** `PATCH /sandbox/results/:id/review` — the owner's verdict. */
export const sandboxResultReviewSchema = z.strictObject({
  status: z.enum(SANDBOX_REVIEW_STATUSES),
  note: z.string().trim().max(2_000).nullable().optional(),
});

export type SandboxResultReview = z.infer<typeof sandboxResultReviewSchema>;
