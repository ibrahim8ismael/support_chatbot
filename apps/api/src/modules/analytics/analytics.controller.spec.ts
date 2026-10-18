import { describe, expect, it, vi } from 'vitest';

import type {
  AnalyticsOverview,
  AnalyticsTimeseries,
  UnansweredQuestion,
} from '@support-agent/shared';

import { AnalyticsController } from './analytics.controller';
import type { AnalyticsService } from './analytics.service';

const OVERVIEW: AnalyticsOverview = {
  conversations: 10,
  botAnswered: 8,
  deflectionRate: 0.8,
  escalationRate: 0.1,
  avgLatencyMs: 500,
  p95LatencyMs: 900,
  tokensIn: 100,
  tokensOut: 20,
  estimatedCostUsd: 0.01,
};

const TIMESERIES: AnalyticsTimeseries = {
  interval: 'day',
  from: '2026-10-17T00:00:00.000Z',
  to: '2026-10-18T00:00:00.000Z',
  points: [{ bucket: '2026-10-17T00:00:00.000Z', ...OVERVIEW }],
};

const QUESTION: UnansweredQuestion = {
  query: 'how do i reset my password',
  count: 3,
  lastSeen: '2026-10-18T09:00:00.000Z',
  sampleConversationId: '11111111-1111-4111-8111-111111111111',
};

function buildHarness() {
  const overview = vi.fn(async (_query: unknown) => OVERVIEW);
  const timeseries = vi.fn(async (_query: unknown) => TIMESERIES);
  const unanswered = vi.fn(async (_query: unknown) => [QUESTION]);
  const service = { overview, timeseries, unanswered } as unknown as AnalyticsService;

  return { controller: new AnalyticsController(service), overview, timeseries, unanswered };
}

describe('AnalyticsController', () => {
  it('delegates the parsed queries to the service', async () => {
    const { controller, overview, timeseries, unanswered } = buildHarness();
    const query = {
      from: '2026-10-11T00:00:00.000Z',
      to: '2026-10-18T00:00:00.000Z',
      inboxId: 3,
    };

    await expect(controller.overview(query)).resolves.toEqual(OVERVIEW);
    expect(overview).toHaveBeenCalledWith(query);

    const timeseriesQuery = { ...query, interval: 'week' as const };
    await expect(controller.timeseries(timeseriesQuery)).resolves.toEqual(TIMESERIES);
    expect(timeseries).toHaveBeenCalledWith(timeseriesQuery);

    const unansweredQuery = { ...query, limit: 5 };
    await expect(controller.unanswered(unansweredQuery)).resolves.toEqual([QUESTION]);
    expect(unanswered).toHaveBeenCalledWith(unansweredQuery);
  });
});
