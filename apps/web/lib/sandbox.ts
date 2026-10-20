import type {
  SandboxExpectedBehavior,
  SandboxMetric,
  SandboxResult,
  SandboxRunStatus,
} from '@support-agent/shared';

/**
 * Pure Sandbox UI helpers (docs/product/sandbox.md): labels, rates, failure
 * reasons, and CSV export. Keeping them here lets the view stay presentational
 * and gives the logic a fast test surface.
 */

export const BEHAVIOR_LABELS: Record<SandboxExpectedBehavior, string> = {
  answer: 'Should answer',
  escalate: 'Should escalate',
  either: 'Either is fine',
};

export const RUN_STATUS_LABELS: Record<SandboxRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export function formatMetric(metric: SandboxMetric): string {
  return `${metric.passed}/${metric.total}`;
}

export function runStatusColor(
  status: SandboxRunStatus,
): 'default' | 'warning' | 'success' | 'danger' {
  switch (status) {
    case 'queued':
      return 'default';
    case 'running':
      return 'warning';
    case 'completed':
      return 'success';
    case 'cancelled':
      return 'default';
    default:
      return 'danger';
  }
}

/** Human-readable reasons a result failed, in check order. */
export function failureReasons(result: SandboxResult): string[] {
  if (result.status === 'error') {
    return [result.error ?? 'Pipeline error'];
  }
  if (result.status === 'pending') {
    return ['Waiting to run'];
  }

  const reasons: string[] = [];
  if (result.checks.behaviorOk === false) {
    reasons.push(
      result.escalated
        ? 'Escalated but should have answered'
        : 'Answered but should have escalated',
    );
  }
  if (result.checks.retrievalHit === false) {
    reasons.push(
      result.expectedFilenames.length > 0
        ? `Expected source not retrieved: ${result.expectedFilenames.join(', ')}`
        : 'Expected source not retrieved',
    );
  }
  if (result.checks.requiredOk === false) {
    const missing = result.requiredPhrases.filter(
      (phrase) => !result.requiredHits.includes(phrase),
    );
    reasons.push(
      `Missing required phrase${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
    );
  }
  if (result.checks.forbiddenOk === false) {
    reasons.push(`Forbidden phrase in reply: ${result.forbiddenHits.join(', ')}`);
  }
  return reasons;
}

export function resultVerdict(result: SandboxResult): {
  label: string;
  color: 'default' | 'success' | 'danger' | 'warning';
} {
  if (result.status === 'pending') {
    return { label: 'Pending', color: 'default' };
  }
  if (result.status === 'error') {
    return { label: 'Error', color: 'danger' };
  }
  return result.passed ? { label: 'Pass', color: 'success' } : { label: 'Fail', color: 'danger' };
}

export function reviewLabel(result: SandboxResult): string {
  switch (result.reviewStatus) {
    case 'pass':
      return 'Owner: correct';
    case 'fail':
      return 'Owner: incorrect';
    default:
      return 'Not reviewed';
  }
}

/** Split comma/newline separated form text into unique, trimmed values. */
export function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
}

/** CSV with a header row, quoted values, and a UTF-8 BOM for Excel. */
export function resultsToCsv(results: SandboxResult[]): string {
  const header = [
    'Case',
    'Question',
    'Status',
    'Verdict',
    'Expected behavior',
    'Escalated',
    'Expected source',
    'Retrieval hit',
    'Required phrases',
    'Forbidden phrases',
    'Best score',
    'Answer',
    'Owner review',
    'Error',
  ];

  const rows = results.map((result) => [
    result.caseName,
    result.question,
    result.status,
    resultVerdict(result).label,
    BEHAVIOR_LABELS[result.expectedBehavior],
    result.escalated ? 'yes' : 'no',
    result.expectedFilenames.join('; '),
    result.checks.retrievalHit === null ? '—' : result.checks.retrievalHit ? 'yes' : 'no',
    result.checks.requiredOk === null ? '—' : result.checks.requiredOk ? 'yes' : 'no',
    result.checks.forbiddenOk === null ? '—' : result.checks.forbiddenOk ? 'yes' : 'no',
    result.bestScore === null ? '—' : result.bestScore.toFixed(3),
    result.answer,
    reviewLabel(result),
    result.error ?? '',
  ]);

  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function csvCell(value: string): string {
  // Excel/Sheets treat these as formulas; prefixing with an apostrophe keeps
  // exported answers inert without changing their visible text.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** `18 of 20 cases · 2 need attention` */
export function runHeadline(resultCounts: {
  passed: number;
  failed: number;
  errors: number;
}): string {
  const total = resultCounts.passed + resultCounts.failed + resultCounts.errors;
  const attention = resultCounts.failed + resultCounts.errors;
  return `${resultCounts.passed} of ${total} cases passed · ${attention} need attention`;
}
