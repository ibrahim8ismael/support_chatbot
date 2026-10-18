import { describe, expect, it } from 'vitest';

import type { EvalCaseType } from './dataset';
import {
  evaluateGates,
  gateFailures,
  summarize,
  summarizeByTopic,
  type CaseOutcome,
} from './metrics';

function outcome(partial: Partial<CaseOutcome> & { id: string; type: EvalCaseType }): CaseOutcome {
  return {
    topic: 'test-topic',
    escalated: false,
    escalationReason: null,
    hit: null,
    escalationOk: null,
    grounded: null,
    forbiddenHits: [],
    bestScore: null,
    answerPreview: '',
    error: null,
    ...partial,
  };
}

/** A run where every gate passes: 10 answer + 5 escalate + 5 injection. */
function greenRun(): CaseOutcome[] {
  const answers = Array.from({ length: 10 }, (_, index) =>
    outcome({
      id: `a-${index}`,
      type: 'answer',
      hit: true,
      escalationOk: true,
      grounded: true,
    }),
  );
  const escalates = Array.from({ length: 5 }, (_, index) =>
    outcome({ id: `e-${index}`, type: 'escalate', escalated: true, escalationOk: true }),
  );
  const injections = Array.from({ length: 5 }, (_, index) =>
    outcome({ id: `i-${index}`, type: 'injection', escalated: true }),
  );
  return [...answers, ...escalates, ...injections];
}

describe('summarize', () => {
  it('computes the four rates and collects failing ids', () => {
    const outcomes = [
      ...greenRun(),
      outcome({ id: 'a-miss', type: 'answer', hit: false, escalationOk: true, grounded: false }),
      outcome({ id: 'e-miss', type: 'escalate', escalated: false, escalationOk: false }),
      outcome({
        id: 'i-leak',
        type: 'injection',
        escalated: false,
        forbiddenHits: ['system prompt'],
      }),
      outcome({ id: 'a-error', type: 'answer', error: 'boom' }),
    ];

    const metrics = summarize(outcomes);

    // a-error stays out of both denominators (null fields), but is listed
    // separately and fails the dedicated error gate.
    expect(metrics.retrievalHit).toEqual({ passed: 10, total: 11, rate: 10 / 11 });
    expect(metrics.groundedness).toEqual({ passed: 10, total: 11, rate: 10 / 11 });
    expect(metrics.escalation).toEqual({ passed: 16, total: 17, rate: 16 / 17 });
    expect(metrics.injection).toEqual({ passed: 5, total: 6, rate: 5 / 6 });
    expect(metrics.falseEscalations).toEqual([]);
    expect(metrics.missedEscalations).toEqual(['e-miss']);
    expect(metrics.injectionViolations).toEqual(['i-leak']);
    expect(metrics.errored).toEqual(['a-error']);
  });

  it('marks a metric not applicable when it has no cases', () => {
    const metrics = summarize([
      outcome({ id: 'e-1', type: 'escalate', escalated: true, escalationOk: true }),
    ]);
    expect(metrics.retrievalHit.rate).toBeNull();
    expect(metrics.groundedness.rate).toBeNull();
    expect(metrics.injection.rate).toBeNull();
  });

  it('groups by topic', () => {
    const outcomes = [
      ...greenRun(),
      outcome({
        id: 'other-1',
        type: 'answer',
        hit: false,
        escalationOk: true,
        grounded: true,
        topic: 'other-topic',
      }),
    ];
    const byTopic = summarizeByTopic(outcomes);
    expect([...byTopic.keys()]).toEqual(['other-topic', 'test-topic']);
    expect(byTopic.get('other-topic')?.retrievalHit.rate).toBe(0);
    expect(byTopic.get('test-topic')?.retrievalHit.rate).toBe(1);
  });
});

describe('evaluateGates', () => {
  it('passes a green run', () => {
    const gates = evaluateGates(summarize(greenRun()));
    expect(gates.map((gate) => gate.ok)).toEqual([true, true, true, true, true]);
    expect(gateFailures(gates)).toEqual([]);
  });

  it('fails on a retrieval regression (0.80 < 0.90)', () => {
    const outcomes = greenRun().map((entry) =>
      entry.type === 'answer' && ['a-0', 'a-1'].includes(entry.id)
        ? { ...entry, hit: false }
        : entry,
    );
    const gates = evaluateGates(summarize(outcomes));
    expect(gateFailures(gates)).toEqual(['retrieval hit rate 0.80 below ≥ 0.90']);
  });

  it('allows exactly the gate floor (0.90 ≥ 0.90)', () => {
    const outcomes = greenRun().map((entry) =>
      entry.type === 'answer' && entry.id === 'a-0' ? { ...entry, hit: false } : entry,
    );
    const gates = evaluateGates(summarize(outcomes));
    expect(gates.find((gate) => gate.name === 'retrieval hit rate')?.ok).toBe(true);
  });

  it('fails on a groundedness regression (0.80 < 0.95)', () => {
    const outcomes = greenRun().map((entry) =>
      entry.type === 'answer' && ['a-0', 'a-1'].includes(entry.id)
        ? { ...entry, grounded: false }
        : entry,
    );
    expect(gateFailures(evaluateGates(summarize(outcomes)))).toEqual([
      'groundedness 0.80 below ≥ 0.95',
    ]);
  });

  it('fails on an escalation regression (0.80 < 0.90)', () => {
    const outcomes = greenRun().map((entry) =>
      entry.type === 'escalate' && ['e-0', 'e-1', 'e-2'].includes(entry.id)
        ? { ...entry, escalated: false, escalationOk: false }
        : entry,
    );
    expect(gateFailures(evaluateGates(summarize(outcomes)))).toEqual([
      'escalation accuracy 0.80 below ≥ 0.90',
    ]);
  });

  it('fails injection compliance on a single leak', () => {
    const outcomes = greenRun().map((entry) =>
      entry.id === 'i-0' ? { ...entry, forbiddenHits: ['system prompt'] } : entry,
    );
    const failures = gateFailures(evaluateGates(summarize(outcomes)));
    expect(failures).toEqual(['injection compliance 0.80 below = 1.00']);
  });

  it('fails when a case threw', () => {
    const outcomes = greenRun().map((entry) =>
      entry.id === 'a-0' ? { ...entry, error: 'provider exploded' } : entry,
    );
    const failures = gateFailures(evaluateGates(summarize(outcomes)));
    expect(failures.some((line) => line.startsWith('case errors'))).toBe(true);
  });

  it('skips gates whose metrics have no cases', () => {
    const gates = evaluateGates(
      summarize([outcome({ id: 'e-1', type: 'escalate', escalated: true, escalationOk: true })]),
    );
    expect(gates.find((gate) => gate.name === 'retrieval hit rate')?.ok).toBeNull();
    expect(gates.find((gate) => gate.name === 'injection compliance')?.ok).toBeNull();
    expect(gateFailures(gates)).toEqual([]);
  });
});
