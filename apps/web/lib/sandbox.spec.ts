import { describe, expect, it } from 'vitest';

import type { SandboxResult } from '@support-agent/shared';

import {
  BEHAVIOR_LABELS,
  failureReasons,
  formatMetric,
  formatRate,
  resultVerdict,
  resultsToCsv,
  runStatusColor,
  splitList,
} from './sandbox';

const result: SandboxResult = {
  id: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  caseId: null,
  caseName: 'Reset password',
  question: 'How do I reset my password?',
  history: [],
  expectedBehavior: 'answer',
  expectedFilenames: ['forgot-password.md'],
  requiredPhrases: ['sign-in'],
  forbiddenPhrases: ['PWNED'],
  referenceAnswer: null,
  position: 0,
  status: 'completed',
  answer: 'Open the sign-in page and choose "Forgot password".',
  escalated: false,
  escalationReason: null,
  chunks: [],
  bestScore: 0.72,
  passed: true,
  checks: { behaviorOk: true, retrievalHit: true, requiredOk: true, forbiddenOk: null },
  requiredHits: ['sign-in'],
  forbiddenHits: [],
  latency: { retrievalMs: 10, generationMs: 20, totalMs: 30 },
  tokens: { input: 10, output: 20 },
  model: 'mock',
  promptVersion: 'answer.v2',
  error: null,
  reviewStatus: 'unreviewed',
  reviewNote: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-10-20T00:00:00.000Z',
};

describe('sandbox view helpers', () => {
  it('formats rates and metric counts', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0.756)).toBe('76%');
    expect(formatMetric({ passed: 3, total: 4, rate: 0.75 })).toBe('3/4');
  });

  it('maps verdicts and behavior labels', () => {
    expect(resultVerdict(result)).toEqual({ label: 'Pass', color: 'success' });
    expect(resultVerdict({ ...result, status: 'error', error: 'boom' })).toEqual({
      label: 'Error',
      color: 'danger',
    });
    expect(BEHAVIOR_LABELS.escalate).toBe('Should escalate');
    expect(runStatusColor('cancelled')).toBe('default');
    expect(runStatusColor('failed')).toBe('danger');
  });

  it('explains failed checks in plain language', () => {
    expect(
      failureReasons({
        ...result,
        passed: false,
        checks: { behaviorOk: false, retrievalHit: false, requiredOk: false, forbiddenOk: false },
        requiredHits: [],
        forbiddenHits: ['PWNED'],
      }),
    ).toEqual([
      'Answered but should have escalated',
      'Expected source not retrieved: forgot-password.md',
      'Missing required phrase: sign-in',
      'Forbidden phrase in reply: PWNED',
    ]);
  });

  it('reports pipeline errors instead of checks', () => {
    expect(failureReasons({ ...result, status: 'error', error: 'provider timeout' })).toEqual([
      'provider timeout',
    ]);
  });

  it('splits comma and newline separated lists uniquely', () => {
    expect(splitList('refund, 30 days\nrefund\n\ncancellation')).toEqual([
      'refund',
      '30 days',
      'cancellation',
    ]);
  });

  it('exports results as quoted CSV with a BOM and escaped quotes', () => {
    const csv = resultsToCsv([{ ...result, answer: 'Say "hello", then wait.' }]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Reset password"');
    expect(csv).toContain('"Say ""hello"", then wait."');
    expect(csv).toContain('"Pass"');
  });

  it('neutralizes spreadsheet formula injection in exported cells', () => {
    const csv = resultsToCsv([{ ...result, answer: '=HYPERLINK("https://example.test")' }]);
    expect(csv).toContain(`"'=HYPERLINK(""https://example.test"")"`);
  });
});
