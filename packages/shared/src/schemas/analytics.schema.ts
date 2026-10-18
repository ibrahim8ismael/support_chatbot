import { z } from 'zod';

/**
 * Analytics query params + response shapes (rest-api.md § Analytics).
 * The metric definitions there are a contract — keep them in sync.
 */

export const ANALYTICS_INTERVALS = ['day', 'week', 'month'] as const;
export const analyticsIntervalSchema = z.enum(ANALYTICS_INTERVALS);
export type AnalyticsInterval = (typeof ANALYTICS_INTERVALS)[number];

/** `GET /analytics/*` shared filters. */
export const analyticsQuerySchema = z.strictObject({
  /** Inclusive range start (ISO 8601); defaults to 7 days before `to`. */
  from: z.iso.datetime({ offset: true }).optional(),
  /** Exclusive range end (ISO 8601); defaults to now. */
  to: z.iso.datetime({ offset: true }).optional(),
  inboxId: z.coerce.number().int().positive().optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const analyticsTimeseriesQuerySchema = analyticsQuerySchema.extend({
  interval: analyticsIntervalSchema.default('day'),
});
export type AnalyticsTimeseriesQuery = z.infer<typeof analyticsTimeseriesQuerySchema>;

export const analyticsUnansweredQuerySchema = analyticsQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type AnalyticsUnansweredQuery = z.infer<typeof analyticsUnansweredQuerySchema>;

/** One range of dashboard numbers (rest-api.md § Metric definitions). */
export interface AnalyticsOverview {
  conversations: number;
  botAnswered: number;
  /** `botAnswered / conversations`, 0 when the range is empty. */
  deflectionRate: number;
  /** Conversations with an escalation outcome / conversations. */
  escalationRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number;
}

/** One chart bucket — same numbers, scoped to the bucket (UTC). */
export interface AnalyticsPoint extends AnalyticsOverview {
  /** Bucket start, ISO 8601 (UTC). */
  bucket: string;
}

export interface AnalyticsTimeseries {
  interval: AnalyticsInterval;
  from: string;
  to: string;
  points: AnalyticsPoint[];
}

/** One clustered group of unanswered questions (admin-only endpoint). */
export interface UnansweredQuestion {
  /** Representative text — the most frequent variant in the group. */
  query: string;
  count: number;
  lastSeen: string;
  sampleConversationId: string;
}
