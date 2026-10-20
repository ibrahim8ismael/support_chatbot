import type {
  AgentChunk,
  SandboxExpectedBehavior,
  SandboxMetrics,
  SandboxResultChecks,
  SandboxResultStatus,
  SandboxReviewStatus,
} from '@support-agent/shared';

/**
 * Pure accuracy checks for sandbox runs (docs/product/sandbox.md § Accuracy).
 *
 * Deliberately deterministic and cheap: expected behavior, expected source
 * documents, required/forbidden phrases. The owner's review is the final word;
 * an LLM judge is a later, explicitly opt-in signal.
 */

export interface SandboxScoreInput {
  expectedBehavior: SandboxExpectedBehavior;
  expectedFilenames: string[];
  requiredPhrases: string[];
  forbiddenPhrases: string[];
  answer: string;
  escalated: boolean;
  chunks: Pick<AgentChunk, 'document'>[];
  error: string | null;
}

export interface SandboxScore {
  passed: boolean;
  checks: SandboxResultChecks;
  requiredHits: string[];
  forbiddenHits: string[];
}

export function scoreSandboxResult(input: SandboxScoreInput): SandboxScore {
  const checks: SandboxResultChecks = {
    behaviorOk: null,
    retrievalHit: null,
    requiredOk: null,
    forbiddenOk: null,
  };

  if (input.error !== null) {
    return { passed: false, checks, requiredHits: [], forbiddenHits: [] };
  }

  checks.behaviorOk =
    input.expectedBehavior === 'answer'
      ? !input.escalated
      : input.expectedBehavior === 'escalate'
        ? input.escalated
        : null;

  if (input.expectedFilenames.length > 0) {
    const expected = new Set(input.expectedFilenames.map(normalize));
    checks.retrievalHit = input.chunks.some((chunk) => expected.has(normalize(chunk.document)));
  }

  const requiredHits = phrasesPresent(input.answer, input.requiredPhrases);
  if (input.requiredPhrases.length > 0) {
    checks.requiredOk = requiredHits.length === input.requiredPhrases.length;
  }

  const forbiddenHits = phrasesPresent(input.answer, input.forbiddenPhrases);
  if (input.forbiddenPhrases.length > 0) {
    checks.forbiddenOk = forbiddenHits.length === 0;
  }

  const passed = Object.values(checks).every((check) => check !== false);
  return { passed, checks, requiredHits, forbiddenHits };
}

/** Metric aggregation for a finished run — same shape as the stored JSON. */
export interface SandboxResultSummaryRow {
  caseName: string;
  status: SandboxResultStatus;
  passed: boolean;
  checks: SandboxResultChecks;
  reviewStatus: SandboxReviewStatus;
  error: string | null;
}

export function summarizeSandboxResults(rows: SandboxResultSummaryRow[]): SandboxMetrics {
  const behavior = rows.filter((row) => row.checks.behaviorOk !== null);
  const retrieval = rows.filter((row) => row.checks.retrievalHit !== null);
  const required = rows.filter((row) => row.checks.requiredOk !== null);
  const forbidden = rows.filter((row) => row.checks.forbiddenOk !== null);
  const reviewed = rows.filter((row) => row.reviewStatus !== 'unreviewed');

  return {
    cases: rows.length,
    autoPass: metric(rows.filter((row) => row.passed).length, rows.length),
    behavior: metric(
      behavior.filter((row) => row.checks.behaviorOk === true).length,
      behavior.length,
    ),
    retrievalHit: metric(
      retrieval.filter((row) => row.checks.retrievalHit === true).length,
      retrieval.length,
    ),
    requiredPhrases: metric(
      required.filter((row) => row.checks.requiredOk === true).length,
      required.length,
    ),
    forbiddenPhrases: metric(
      forbidden.filter((row) => row.checks.forbiddenOk === true).length,
      forbidden.length,
    ),
    verified: metric(reviewed.filter((row) => row.reviewStatus === 'pass').length, reviewed.length),
    errored: rows
      .filter((row) => row.status === 'error' || row.error !== null)
      .map((row) => row.caseName),
  };
}

function metric(passed: number, total: number): SandboxMetrics['autoPass'] {
  return { passed, total, rate: total === 0 ? null : passed / total };
}

function phrasesPresent(answer: string, phrases: string[]): string[] {
  const haystack = answer.toLowerCase();
  return phrases.filter((phrase) => haystack.includes(phrase.toLowerCase()));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
