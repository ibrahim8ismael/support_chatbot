import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Pure helpers for the load-smoke CLI (`scripts/load-smoke.ts`) — kept
 * side-effect-free so the spec can test them without booting the CLI
 * (`scripts/load-smoke.helpers.spec.ts`).
 *
 * Thresholds restate NFR-1 (docs/product/requirements.md): webhook ack
 * ≤ 300 ms, customer message → reply p95 ≤ 15 s, retrieval query ≤ 500 ms.
 */

/** NFR-1: webhook ack ≤ 300 ms. */
export const ACK_P95_LIMIT_MS = 300;
/** NFR-1: end-to-end (message → answer) p95 ≤ 15 s. */
export const E2E_P95_LIMIT_MS = 15_000;
/** NFR-1: retrieval query ≤ 500 ms. */
export const RETRIEVAL_P95_LIMIT_MS = 500;

/**
 * Durability-probe queue. Deliberately NOT one of the real `QUEUES` names:
 * the probe enqueues, restarts Redis and drains with a throwaway consumer, so
 * pointing it at `reply-job` on a production host could race the real workers.
 * The mechanics under test (Redis db 0, AOF, BullMQ defaults) are identical.
 */
export const LOAD_SMOKE_QUEUE = 'load-smoke';

/** Mirrors `QueueService` defaults (ADR-0006): 3 attempts, exponential backoff, keep failures. */
export const LOAD_SMOKE_JOB_DEFAULTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnFail: false,
};

/** A few plausible customer questions; each burst message gets one by index. */
export const LOAD_SMOKE_QUESTIONS = [
  'What does the annual plan cost?',
  'How do I reset my password?',
  'Do you support SSO on the business plan?',
  'What is the refund policy?',
  'How long does onboarding take?',
  'Where can I download invoices?',
];

export interface LatencySummary {
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
}

export interface Evaluation extends LatencySummary {
  label: string;
  unit: string;
  limit: number;
  pass: boolean;
}

/** Nearest-rank percentile (p in 0–100). Deterministic, no interpolation. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error('percentile() needs at least one value');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const value = sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
  if (value === undefined) throw new Error('percentile() index out of range');
  return value;
}

export function summarize(values: number[]): LatencySummary {
  if (values.length === 0) throw new Error('summarize() needs at least one value');
  return {
    count: values.length,
    min: Math.min(...values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
  };
}

/** A latency measurement vs. its NFR limit — the p95 decides pass/fail. */
export function evaluate(label: string, values: number[], limit: number, unit = 'ms'): Evaluation {
  const summary = summarize(values);
  return { label, unit, limit, pass: summary.p95 <= limit, ...summary };
}

export function formatEvaluation(evaluation: Evaluation): string {
  const at = (value: number) => value.toFixed(1);
  return (
    `${evaluation.label}: n=${evaluation.count}` +
    ` p50=${at(evaluation.p50)}${evaluation.unit}` +
    ` p95=${at(evaluation.p95)}${evaluation.unit}` +
    ` max=${at(evaluation.max)}${evaluation.unit}` +
    ` (limit ${evaluation.limit}${evaluation.unit})` +
    ` ${evaluation.pass ? 'PASS' : 'FAIL'}`
  );
}

/** Deterministic `message_created` stand-in (docs/integrations/chatwoot.md shape). */
export function buildChatwootWebhookPayload(
  index: number,
  options: { accountId: number; inboxId: number; conversationBase?: number },
): Record<string, unknown> {
  const conversationBase = options.conversationBase ?? 80_000;
  const question = LOAD_SMOKE_QUESTIONS[index % LOAD_SMOKE_QUESTIONS.length] ?? 'Load smoke';
  return {
    event: 'message_created',
    account: { id: options.accountId },
    conversation: { id: conversationBase + index, inbox_id: options.inboxId, status: 'open' },
    id: 900_000_000 + index,
    message_type: 'incoming',
    content: question,
    sender: { id: 1, name: 'Load Smoke', type: 'contact' },
  };
}

/** Run `fn` over `items` with at most `concurrency` in flight; results keep input order. */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (concurrency < 1) throw new Error('concurrency must be ≥ 1');
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item, index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Walk up from `startDir` to the pnpm workspace root (`pnpm-workspace.yaml`). */
export function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `redis://user:password@host:6379/0` → `redis://user@host:6379/0` (logs must not leak secrets). */
export function maskRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url;
  }
}
