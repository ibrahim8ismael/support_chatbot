import {
  type AnalyticsInterval,
  analyticsQuerySchema,
  analyticsTimeseriesQuerySchema,
  analyticsUnansweredQuerySchema,
} from '@support-agent/shared';

/**
 * Analytics screen helpers: range presets, query building against the shared
 * schemas, and display formatting (docs/api/rest-api.md § Analytics).
 */

export const ANALYTICS_RANGES = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
] as const;
export type AnalyticsRangeId = (typeof ANALYTICS_RANGES)[number]['id'];

export const ANALYTICS_INTERVAL_LABELS: Record<AnalyticsInterval, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
};

/** `from`/`to` ISO strings for a preset; `now` injectable for tests. */
export function rangeFor(range: AnalyticsRangeId, now = new Date()): { from: string; to: string } {
  if (range === 'today') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return { from: start.toISOString(), to: now.toISOString() };
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return {
    from: new Date(now.getTime() - days * 86_400_000).toISOString(),
    to: now.toISOString(),
  };
}

export interface AnalyticsQueryInput {
  from: string;
  to: string;
  inboxId?: number;
  /** Set for `/analytics/timeseries`. */
  interval?: AnalyticsInterval;
  /** Set for `/analytics/unanswered`. */
  limit?: number;
}

/**
 * Validate + serialize query params with the same shared schemas the API
 * parses (defaults included), so the screen and the API can't drift.
 */
export function buildAnalyticsQuery(
  input: AnalyticsQueryInput,
): { ok: true; query: string } | { ok: false; error: string } {
  const schema =
    input.limit !== undefined
      ? analyticsUnansweredQuerySchema
      : input.interval !== undefined
        ? analyticsTimeseriesQuerySchema
        : analyticsQuerySchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid filters' };
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  return { ok: true, query: params.toString() };
}

/** `0.756` → `"75.6%"`. */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatLatencyMs(ms: number): string {
  if (ms <= 0) {
    return '—';
  }
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function formatCost(usd: number): string {
  if (usd === 0) {
    return '$0.00';
  }
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** Chart bucket label — formatted in UTC so tests and users see the same. */
export function bucketLabel(bucketIso: string, interval: AnalyticsInterval): string {
  const date = new Date(bucketIso);
  if (interval === 'month') {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return interval === 'week' ? `Week of ${day}` : day;
}

/** `YYYY-MM-DD HH:mm UTC` for "last seen" cells. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}
