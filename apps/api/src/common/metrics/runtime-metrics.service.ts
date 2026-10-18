import { Injectable } from '@nestjs/common';

/**
 * Process-local counters for signals that are not persisted anywhere (LLM
 * provider failures, webhook 5xx acks). The alert check runs in this same API
 * process, so a restart resets them — a brief false-negative after a restart,
 * accepted for the minimal alerting in docs/operations/deployment.md.
 *
 * Old samples are pruned on write; callers pass a window when reading.
 */
const MAX_WINDOW_MS = 60 * 60_000;

interface LlmCall {
  at: number;
  ok: boolean;
}

@Injectable()
export class RuntimeMetricsService {
  private llmCalls: LlmCall[] = [];
  private webhookFailureTimes: number[] = [];

  recordLlmCall(ok: boolean, at: number = Date.now()): void {
    this.llmCalls.push({ at, ok });
    this.prune(at);
  }

  /** Count a webhook request that failed with 5xx (not 401/404 — those are client errors). */
  recordWebhook5xx(at: number = Date.now()): void {
    this.webhookFailureTimes.push(at);
    this.prune(at);
  }

  llmWindow(windowMs: number, now: number = Date.now()): { calls: number; errors: number } {
    const calls = this.llmCalls.filter((call) => call.at >= now - windowMs);
    return { calls: calls.length, errors: calls.filter((call) => !call.ok).length };
  }

  webhook5xx(windowMs: number, now: number = Date.now()): number {
    return this.webhookFailureTimes.filter((at) => at >= now - windowMs).length;
  }

  private prune(now: number): void {
    const from = now - MAX_WINDOW_MS;
    this.llmCalls = this.llmCalls.filter((call) => call.at >= from);
    this.webhookFailureTimes = this.webhookFailureTimes.filter((at) => at >= from);
  }
}
