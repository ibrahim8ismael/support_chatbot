import { describe, expect, it } from 'vitest';

import { RuntimeMetricsService } from './runtime-metrics.service';

const MINUTE = 60_000;

describe('RuntimeMetricsService', () => {
  it('reports LLM calls and errors inside the requested window only', () => {
    const metrics = new RuntimeMetricsService();
    const now = Date.now();

    metrics.recordLlmCall(true, now - 10 * MINUTE);
    metrics.recordLlmCall(false, now - 4 * MINUTE);
    metrics.recordLlmCall(true, now - 3 * MINUTE);
    metrics.recordLlmCall(false, now - 2 * MINUTE);

    expect(metrics.llmWindow(5 * MINUTE, now)).toEqual({ calls: 3, errors: 2 });
    expect(metrics.llmWindow(15 * MINUTE, now)).toEqual({ calls: 4, errors: 2 });
  });

  it('counts webhook 5xx inside the window', () => {
    const metrics = new RuntimeMetricsService();
    const now = Date.now();

    metrics.recordWebhook5xx(now - 11 * MINUTE);
    metrics.recordWebhook5xx(now - 9 * MINUTE);
    metrics.recordWebhook5xx(now - MINUTE);

    expect(metrics.webhook5xx(10 * MINUTE, now)).toBe(2);
    expect(metrics.webhook5xx(60 * MINUTE, now)).toBe(3);
    expect(metrics.webhook5xx(30_000, now)).toBe(0);
  });

  it('prunes samples older than an hour on write', () => {
    const metrics = new RuntimeMetricsService();
    const now = Date.now();

    metrics.recordLlmCall(false, now - 2 * 60 * MINUTE);
    metrics.recordLlmCall(true, now);

    // The stale failure is gone even when the caller asks for a huge window.
    expect(metrics.llmWindow(3 * 60 * MINUTE, now)).toEqual({ calls: 1, errors: 0 });
  });
});
