import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import {
  QUEUES,
  SANDBOX_MAX_CASES_PER_RUN,
  SANDBOX_MAX_RUNS_PER_DAY,
  type PlaygroundTurn,
  type SandboxCase,
  type SandboxCaseInput,
  type SandboxCaseUpdate,
  type SandboxResult,
  type SandboxResultReview,
  type SandboxRun,
  type SandboxRunInput,
} from '@support-agent/shared';

import { DatabaseService } from '../../db/database.service';
import { AgentService } from '../agent/agent.service';
import { ANSWER_PROMPT_VERSION } from '../agent/prompts/answer.v2';
import { AnalyticsService } from '../analytics/analytics.service';
import { QueueService } from '../infra/queue.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { estimateCostUsd, toCostString } from '../llm/pricing';
import { SettingsService } from '../settings/settings.service';
import { sandboxCases } from './entities/sandbox-case.entity';
import { sandboxResults } from './entities/sandbox-result.entity';
import { sandboxRuns } from './entities/sandbox-run.entity';
import { sandboxRetryJobId, sandboxRunJobId } from './sandbox.jobs';
import { scoreSandboxResult, summarizeSandboxResults } from './scoring';

type CaseRow = typeof sandboxCases.$inferSelect;
type RunRow = typeof sandboxRuns.$inferSelect;
type ResultRow = typeof sandboxResults.$inferSelect;

/** Run history is capped: it is a working tool, not an archive. */
const MAX_RUN_HISTORY = 50;

/** Default result shape for rows that have not run yet. */
const EMPTY_CHECKS = {
  behaviorOk: null,
  retrievalHit: null,
  requiredOk: null,
  forbiddenOk: null,
} as const;

const EMPTY_LATENCY = { retrievalMs: 0, generationMs: 0, totalMs: 0 };
const EMPTY_TOKENS = { input: 0, output: 0 };

/**
 * Sandbox — owns `sandbox_cases`, `sandbox_runs`, and `sandbox_results`
 * (docs/product/sandbox.md). Case edits, run creation, cancellation, retries,
 * and owner reviews live here; the BullMQ worker delegates execution back to
 * `processRun()` so the batch logic is testable without a queue.
 *
 * Does NOT write `answer_events`: those rows require conversation/message
 * context and feed production analytics. Sandbox runs are intentionally
 * isolated.
 */
@Injectable()
export class SandboxService {
  private readonly provider: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly agent: AgentService,
    private readonly knowledgeBase: KnowledgeBaseService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
    private readonly analytics: AnalyticsService,
    config: ConfigService,
  ) {
    this.provider = config.get<string>('LLM_PROVIDER') ?? 'mock';
  }

  // ---------------------------------------------------------------------------
  // Cases
  // ---------------------------------------------------------------------------

  async listCases(): Promise<SandboxCase[]> {
    const rows = await this.database.db
      .select()
      .from(sandboxCases)
      .orderBy(desc(sandboxCases.updatedAt));
    return rows.map(toCase);
  }

  async createCase(input: SandboxCaseInput, userId: string): Promise<SandboxCase> {
    const question = input.question.trim();
    const name = input.name?.trim() || truncate(question, 120);

    const [row] = await this.database.db
      .insert(sandboxCases)
      .values({
        name,
        question,
        kbIds: unique(input.kbIds),
        history: input.history ?? [],
        expectedBehavior: input.expectedBehavior,
        expectedFilenames: normalizeList(input.expectedFilenames ?? []),
        requiredPhrases: normalizeList(input.requiredPhrases ?? []),
        forbiddenPhrases: normalizeList(input.forbiddenPhrases ?? []),
        referenceAnswer: input.referenceAnswer ?? null,
        tags: normalizeList(input.tags ?? []),
        notes: input.notes ?? null,
        isEnabled: input.isEnabled ?? true,
        createdBy: userId,
      })
      .returning();

    if (!row) {
      throw new Error('failed to create sandbox case');
    }

    await this.analytics.recordAuditLog({
      userId,
      action: 'sandbox.case.create',
      entity: 'sandbox_case',
      entityId: row.id,
      data: { name: row.name, question: row.question, kbIds: row.kbIds },
    });
    return toCase(row);
  }

  async updateCase(id: string, patch: SandboxCaseUpdate, userId: string): Promise<SandboxCase> {
    const values: Partial<typeof sandboxCases.$inferInsert> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.question !== undefined) values.question = patch.question;
    if (patch.kbIds !== undefined) values.kbIds = unique(patch.kbIds);
    if (patch.history !== undefined) values.history = patch.history;
    if (patch.expectedBehavior !== undefined) values.expectedBehavior = patch.expectedBehavior;
    if (patch.expectedFilenames !== undefined) {
      values.expectedFilenames = normalizeList(patch.expectedFilenames);
    }
    if (patch.requiredPhrases !== undefined) {
      values.requiredPhrases = normalizeList(patch.requiredPhrases);
    }
    if (patch.forbiddenPhrases !== undefined) {
      values.forbiddenPhrases = normalizeList(patch.forbiddenPhrases);
    }
    if (patch.referenceAnswer !== undefined) values.referenceAnswer = patch.referenceAnswer;
    if (patch.tags !== undefined) values.tags = normalizeList(patch.tags);
    if (patch.notes !== undefined) values.notes = patch.notes;
    if (patch.isEnabled !== undefined) values.isEnabled = patch.isEnabled;

    const [row] = await this.database.db
      .update(sandboxCases)
      .set(values)
      .where(eq(sandboxCases.id, id))
      .returning();

    if (!row) {
      throw new NotFoundException(`sandbox case ${id} not found`);
    }

    await this.analytics.recordAuditLog({
      userId,
      action: 'sandbox.case.update',
      entity: 'sandbox_case',
      entityId: row.id,
      data: { patch },
    });
    return toCase(row);
  }

  async deleteCase(id: string, userId: string): Promise<void> {
    const [row] = await this.database.db
      .delete(sandboxCases)
      .where(eq(sandboxCases.id, id))
      .returning({ id: sandboxCases.id, name: sandboxCases.name });

    if (!row) {
      throw new NotFoundException(`sandbox case ${id} not found`);
    }

    await this.analytics.recordAuditLog({
      userId,
      action: 'sandbox.case.delete',
      entity: 'sandbox_case',
      entityId: row.id,
      data: { name: row.name },
    });
  }

  // ---------------------------------------------------------------------------
  // Runs
  // ---------------------------------------------------------------------------

  async listRuns(): Promise<SandboxRun[]> {
    const rows = await this.database.db
      .select()
      .from(sandboxRuns)
      .orderBy(desc(sandboxRuns.createdAt))
      .limit(MAX_RUN_HISTORY);
    return rows.map(toRun);
  }

  async getRun(id: string): Promise<SandboxRun> {
    return toRun(await this.loadRun(id));
  }

  async listResults(runId: string): Promise<SandboxResult[]> {
    await this.loadRun(runId);
    const rows = await this.database.db
      .select()
      .from(sandboxResults)
      .where(eq(sandboxResults.runId, runId))
      .orderBy(asc(sandboxResults.position));
    return rows.map(toResult);
  }

  /**
   * Validate KBs/cases, snapshot everything, and enqueue one batch job.
   * The snapshot is the point: edits after this call cannot change the run.
   */
  async createRun(input: SandboxRunInput, userId: string): Promise<SandboxRun> {
    const kbIds = unique(input.kbIds);
    const summaries = await Promise.all(kbIds.map((id) => this.knowledgeBase.getSummary(id)));
    const archived = summaries.filter((summary) => summary.status !== 'active');
    if (archived.length > 0) {
      throw new BadRequestException(
        `archived knowledge bases cannot be tested: ${archived.map((kb) => kb.name).join(', ')}`,
      );
    }

    const cases = await this.loadCasesForRun(input.caseIds);
    if (cases.length === 0) {
      throw new BadRequestException('no cases selected — create a test case first');
    }
    if (cases.length > SANDBOX_MAX_CASES_PER_RUN) {
      throw new BadRequestException(
        `a run is capped at ${SANDBOX_MAX_CASES_PER_RUN} cases (selected ${cases.length})`,
      );
    }

    await this.enforceDailyRunCap(userId);

    const settingsSnapshot = await this.settings.get();
    const name = input.name?.trim() || `Sandbox run ${new Date().toISOString()}`;

    const run = await this.database.db.transaction(async (tx) => {
      const [runRow] = await tx
        .insert(sandboxRuns)
        .values({
          name,
          createdBy: userId,
          caseCount: cases.length,
          kbIds,
          caseIds: cases.map((item) => item.id),
          settingsSnapshot,
          promptVersion: ANSWER_PROMPT_VERSION,
          provider: this.provider,
        })
        .returning();

      if (!runRow) {
        throw new Error('failed to create sandbox run');
      }

      await tx.insert(sandboxResults).values(
        cases.map((item, position) => ({
          runId: runRow.id,
          caseId: item.id,
          caseName: item.name,
          question: item.question,
          history: item.history,
          expectedBehavior: item.expectedBehavior,
          expectedFilenames: item.expectedFilenames,
          requiredPhrases: item.requiredPhrases,
          forbiddenPhrases: item.forbiddenPhrases,
          referenceAnswer: item.referenceAnswer,
          position,
          promptVersion: ANSWER_PROMPT_VERSION,
          checks: EMPTY_CHECKS,
          latency: EMPTY_LATENCY,
          tokens: EMPTY_TOKENS,
        })),
      );

      return runRow;
    });

    try {
      await this.queue.enqueue(
        QUEUES.sandbox,
        'sandbox-run',
        { runId: run.id },
        { jobId: sandboxRunJobId(run.id) },
      );
    } catch (error) {
      const message = readableError(error);
      await this.database.db
        .update(sandboxRuns)
        .set({
          status: 'failed',
          error: `could not queue the run: ${message}`,
          finishedAt: new Date(),
        })
        .where(eq(sandboxRuns.id, run.id));
      throw new ServiceUnavailableException('sandbox queue unavailable — try again');
    }

    await this.analytics.recordAuditLog({
      userId,
      action: 'sandbox.run.start',
      entity: 'sandbox_run',
      entityId: run.id,
      data: { name: run.name, cases: cases.length, kbIds },
    });
    return toRun(run);
  }

  /**
   * Execute every pending result. Called by the BullMQ worker; safe to resume
   * after a crash because completed rows are skipped.
   */
  async processRun(runId: string): Promise<void> {
    const run = await this.loadRunOrNull(runId);
    if (!run || run.status === 'completed' || run.status === 'cancelled') {
      return;
    }

    await this.database.db
      .update(sandboxRuns)
      .set({ status: 'running', startedAt: run.startedAt ?? new Date(), error: null })
      .where(eq(sandboxRuns.id, runId));

    const pending = await this.database.db
      .select()
      .from(sandboxResults)
      .where(and(eq(sandboxResults.runId, runId), eq(sandboxResults.status, 'pending')))
      .orderBy(asc(sandboxResults.position));

    for (const result of pending) {
      if (await this.isCancelled(runId)) {
        return;
      }
      await this.runResult(run, result);
      await this.database.db
        .update(sandboxRuns)
        .set({ completedCount: sql`${sandboxRuns.completedCount} + 1` })
        .where(eq(sandboxRuns.id, runId));
    }

    await this.finalizeRun(runId);
  }

  async cancelRun(id: string, userId: string): Promise<SandboxRun> {
    const run = await this.loadRun(id);
    if (run.status === 'cancelled') {
      return toRun(run);
    }
    if (run.status === 'completed' || run.status === 'failed') {
      throw new BadRequestException('this run has already finished');
    }

    const [row] = await this.database.db
      .update(sandboxRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(eq(sandboxRuns.id, id), inArray(sandboxRuns.status, ['queued', 'running'])))
      .returning();

    if (!row) {
      // The worker finished between our read and write — return the final state.
      return toRun(await this.loadRun(id));
    }

    await this.analytics.recordAuditLog({
      userId,
      action: 'sandbox.run.cancel',
      entity: 'sandbox_run',
      entityId: row.id,
    });
    return toRun(row);
  }

  /** Reset errored cases (and resume cancelled/failed pending ones), then requeue. */
  async retryFailed(id: string, userId: string): Promise<SandboxRun> {
    const run = await this.loadRun(id);
    if (run.status === 'queued' || run.status === 'running') {
      throw new BadRequestException('wait for the run to finish before retrying');
    }

    const failed = await this.database.db
      .select({ id: sandboxResults.id })
      .from(sandboxResults)
      .where(and(eq(sandboxResults.runId, id), eq(sandboxResults.status, 'error')));
    const [pending] = await this.database.db
      .select({ value: count() })
      .from(sandboxResults)
      .where(and(eq(sandboxResults.runId, id), eq(sandboxResults.status, 'pending')));

    if (failed.length === 0 && Number(pending?.value ?? 0) === 0) {
      throw new BadRequestException('this run has no failed or pending cases');
    }

    const updated = await this.database.db.transaction(async (tx) => {
      await tx
        .update(sandboxResults)
        .set({
          status: 'pending',
          answer: '',
          escalated: false,
          escalationReason: null,
          chunks: [],
          bestScore: null,
          passed: false,
          checks: EMPTY_CHECKS,
          requiredHits: [],
          forbiddenHits: [],
          latency: EMPTY_LATENCY,
          tokens: EMPTY_TOKENS,
          model: null,
          error: null,
          reviewStatus: 'unreviewed',
          reviewNote: null,
          reviewedBy: null,
          reviewedAt: null,
        })
        .where(and(eq(sandboxResults.runId, id), eq(sandboxResults.status, 'error')));

      const [row] = await tx
        .update(sandboxRuns)
        .set({
          status: 'queued',
          completedCount: sql`greatest(${sandboxRuns.completedCount} - ${failed.length}, 0)`,
          metrics: null,
          error: null,
          finishedAt: null,
        })
        .where(eq(sandboxRuns.id, id))
        .returning();

      if (!row) {
        throw new NotFoundException(`sandbox run ${id} not found`);
      }
      return row;
    });

    try {
      await this.queue.enqueue(
        QUEUES.sandbox,
        'sandbox-run',
        { runId: id },
        {
          jobId: sandboxRetryJobId(id),
        },
      );
    } catch (error) {
      // Do not leave the run stuck in `queued` with no job behind it.
      await this.database.db
        .update(sandboxRuns)
        .set({
          status: 'failed',
          error: `could not queue the retry: ${readableError(error)}`,
          finishedAt: new Date(),
        })
        .where(eq(sandboxRuns.id, id));
      throw new ServiceUnavailableException('sandbox queue unavailable — try again');
    }

    await this.analytics.recordAuditLog({
      userId,
      action: 'sandbox.run.retry',
      entity: 'sandbox_run',
      entityId: id,
      data: { failed: failed.length },
    });
    return toRun(updated);
  }

  async reviewResult(
    id: string,
    review: SandboxResultReview,
    userId: string,
  ): Promise<SandboxResult> {
    const reviewed = review.status !== 'unreviewed';
    const [row] = await this.database.db
      .update(sandboxResults)
      .set({
        reviewStatus: review.status,
        reviewNote: review.note ?? null,
        reviewedBy: reviewed ? userId : null,
        reviewedAt: reviewed ? new Date() : null,
      })
      .where(eq(sandboxResults.id, id))
      .returning();

    if (!row) {
      throw new NotFoundException(`sandbox result ${id} not found`);
    }

    await this.recomputeMetrics(row.runId);

    await this.analytics.recordAuditLog({
      userId,
      action: 'sandbox.result.review',
      entity: 'sandbox_result',
      entityId: row.id,
      data: { runId: row.runId, status: review.status },
    });
    return toResult(row);
  }

  /** Last-attempt failure hook used by the worker (mirrors ingestion). */
  async markRunFailed(runId: string, message: string): Promise<void> {
    await this.database.db
      .update(sandboxRuns)
      .set({ status: 'failed', error: message, finishedAt: new Date() })
      .where(and(eq(sandboxRuns.id, runId), inArray(sandboxRuns.status, ['queued', 'running'])));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async runResult(run: RunRow, result: ResultRow): Promise<void> {
    try {
      const answer = await this.agent.ask({
        question: result.question,
        kbIds: run.kbIds,
        history: result.history as PlaygroundTurn[],
      });
      const score = scoreSandboxResult({
        expectedBehavior: result.expectedBehavior,
        expectedFilenames: result.expectedFilenames,
        requiredPhrases: result.requiredPhrases,
        forbiddenPhrases: result.forbiddenPhrases,
        answer: answer.answer,
        escalated: answer.escalated,
        chunks: answer.chunks,
        error: null,
      });

      await this.database.db
        .update(sandboxResults)
        .set({
          status: 'completed',
          answer: answer.answer,
          escalated: answer.escalated,
          escalationReason: answer.escalationReason,
          chunks: answer.chunks,
          bestScore: answer.chunks[0]?.score ?? null,
          passed: score.passed,
          checks: score.checks,
          requiredHits: score.requiredHits,
          forbiddenHits: score.forbiddenHits,
          latency: answer.latency,
          tokens: answer.tokens,
          model: answer.model,
          promptVersion: answer.promptVersion,
          error: null,
        })
        .where(eq(sandboxResults.id, result.id));
    } catch (error) {
      await this.database.db
        .update(sandboxResults)
        .set({
          status: 'error',
          error: readableError(error),
          passed: false,
        })
        .where(eq(sandboxResults.id, result.id));
    }
  }

  private async finalizeRun(runId: string): Promise<void> {
    const rows = await this.database.db
      .select()
      .from(sandboxResults)
      .where(eq(sandboxResults.runId, runId));

    const metrics = summarizeSandboxResults(
      rows.map((row) => ({
        caseName: row.caseName,
        status: row.status,
        passed: row.passed,
        checks: row.checks,
        reviewStatus: row.reviewStatus,
        error: row.error,
      })),
    );

    let cost = 0;
    let costKnown = false;
    let tokensIn = 0;
    let tokensOut = 0;
    for (const row of rows) {
      tokensIn += row.tokens.input;
      tokensOut += row.tokens.output;
      const estimate = estimateCostUsd(row.model, row.tokens.input, row.tokens.output);
      if (estimate !== null) {
        cost += estimate;
        costKnown = true;
      }
    }

    await this.database.db
      .update(sandboxRuns)
      .set({
        status: 'completed',
        completedCount: rows.length,
        metrics,
        totalTokensIn: tokensIn,
        totalTokensOut: tokensOut,
        estimatedCostUsd: costKnown ? toCostString(cost) : null,
        finishedAt: new Date(),
        error: null,
      })
      .where(and(eq(sandboxRuns.id, runId), inArray(sandboxRuns.status, ['queued', 'running'])));
  }

  private async recomputeMetrics(runId: string): Promise<void> {
    const rows = await this.database.db
      .select()
      .from(sandboxResults)
      .where(eq(sandboxResults.runId, runId));
    const metrics = summarizeSandboxResults(
      rows.map((row) => ({
        caseName: row.caseName,
        status: row.status,
        passed: row.passed,
        checks: row.checks,
        reviewStatus: row.reviewStatus,
        error: row.error,
      })),
    );
    await this.database.db.update(sandboxRuns).set({ metrics }).where(eq(sandboxRuns.id, runId));
  }

  private async isCancelled(runId: string): Promise<boolean> {
    const [row] = await this.database.db
      .select({ status: sandboxRuns.status })
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, runId))
      .limit(1);
    return row?.status === 'cancelled';
  }

  private async loadCasesForRun(caseIds: string[] | undefined): Promise<CaseRow[]> {
    if (!caseIds) {
      return this.database.db
        .select()
        .from(sandboxCases)
        .where(eq(sandboxCases.isEnabled, true))
        .orderBy(desc(sandboxCases.updatedAt));
    }

    const uniqueIds = unique(caseIds);
    const rows = await this.database.db
      .select()
      .from(sandboxCases)
      .where(inArray(sandboxCases.id, uniqueIds));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const missing = uniqueIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`sandbox case(s) not found: ${missing.join(', ')}`);
    }
    return uniqueIds.map((id) => byId.get(id) as CaseRow);
  }

  private async enforceDailyRunCap(userId: string): Promise<void> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [row] = await this.database.db
      .select({ value: count() })
      .from(sandboxRuns)
      .where(and(eq(sandboxRuns.createdBy, userId), gte(sandboxRuns.createdAt, startOfDay)));

    if (Number(row?.value ?? 0) >= SANDBOX_MAX_RUNS_PER_DAY) {
      throw new HttpException(
        `daily sandbox limit reached (${SANDBOX_MAX_RUNS_PER_DAY} runs) — try again tomorrow`,
        429,
      );
    }
  }

  private async loadRun(id: string): Promise<RunRow> {
    const run = await this.loadRunOrNull(id);
    if (!run) {
      throw new NotFoundException(`sandbox run ${id} not found`);
    }
    return run;
  }

  private async loadRunOrNull(id: string): Promise<RunRow | null> {
    const [row] = await this.database.db
      .select()
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, id))
      .limit(1);
    return row ?? null;
  }
}

// -----------------------------------------------------------------------------
// Serializers — DB rows use Date/numeric; the API contract uses ISO strings.
// -----------------------------------------------------------------------------

function toCase(row: CaseRow): SandboxCase {
  return {
    id: row.id,
    name: row.name,
    question: row.question,
    kbIds: row.kbIds,
    history: row.history,
    expectedBehavior: row.expectedBehavior,
    expectedFilenames: row.expectedFilenames,
    requiredPhrases: row.requiredPhrases,
    forbiddenPhrases: row.forbiddenPhrases,
    referenceAnswer: row.referenceAnswer,
    tags: row.tags,
    notes: row.notes,
    isEnabled: row.isEnabled,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRun(row: RunRow): SandboxRun {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    caseCount: row.caseCount,
    completedCount: row.completedCount,
    kbIds: row.kbIds,
    caseIds: row.caseIds,
    settingsSnapshot: row.settingsSnapshot as unknown as Record<string, unknown>,
    promptVersion: row.promptVersion,
    provider: row.provider,
    metrics: row.metrics,
    totalTokensIn: row.totalTokensIn,
    totalTokensOut: row.totalTokensOut,
    estimatedCostUsd: row.estimatedCostUsd,
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toResult(row: ResultRow): SandboxResult {
  return {
    id: row.id,
    runId: row.runId,
    caseId: row.caseId,
    caseName: row.caseName,
    question: row.question,
    history: row.history,
    expectedBehavior: row.expectedBehavior,
    expectedFilenames: row.expectedFilenames,
    requiredPhrases: row.requiredPhrases,
    forbiddenPhrases: row.forbiddenPhrases,
    referenceAnswer: row.referenceAnswer,
    position: row.position,
    status: row.status,
    answer: row.answer,
    escalated: row.escalated,
    escalationReason: row.escalationReason,
    chunks: row.chunks as unknown as SandboxResult['chunks'],
    bestScore: row.bestScore,
    passed: row.passed,
    checks: row.checks,
    requiredHits: row.requiredHits,
    forbiddenHits: row.forbiddenHits,
    latency: row.latency,
    tokens: row.tokens,
    model: row.model,
    promptVersion: row.promptVersion,
    error: row.error,
    reviewStatus: row.reviewStatus,
    reviewNote: row.reviewNote,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeList(values: string[]): string[] {
  return unique(values.map((value) => value.trim()).filter((value) => value.length > 0));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 1_000 ? `${message.slice(0, 997)}...` : message;
}
