import { describe, expect, it } from 'vitest';

import {
  buildAnalyticsQuery,
  bucketLabel,
  formatCost,
  formatCount,
  formatLatencyMs,
  formatRate,
  formatTimestamp,
  rangeFor,
} from './analytics';

const NOW = new Date('2026-10-18T12:30:00.000Z');

describe('rangeFor', () => {
  it('starts "today" at UTC midnight', () => {
    expect(rangeFor('today', NOW)).toEqual({
      from: '2026-10-18T00:00:00.000Z',
      to: '2026-10-18T12:30:00.000Z',
    });
  });

  it('subtracts the preset window for 7/30/90 days', () => {
    expect(rangeFor('7d', NOW).from).toBe('2026-10-11T12:30:00.000Z');
    expect(rangeFor('30d', NOW).from).toBe('2026-09-18T12:30:00.000Z');
    expect(rangeFor('90d', NOW).from).toBe('2026-07-20T12:30:00.000Z');
    expect(rangeFor('90d', NOW).to).toBe(NOW.toISOString());
  });
});

describe('buildAnalyticsQuery', () => {
  const range = { from: '2026-10-11T00:00:00.000Z', to: '2026-10-18T00:00:00.000Z' };

  it('serializes the base filters', () => {
    const result = buildAnalyticsQuery({ ...range, inboxId: 3 });

    expect(result).toEqual({
      ok: true,
      query: 'from=2026-10-11T00%3A00%3A00.000Z&to=2026-10-18T00%3A00%3A00.000Z&inboxId=3',
    });
  });

  it('applies the shared defaults (interval, limit)', () => {
    const timeseries = buildAnalyticsQuery({ ...range, interval: 'day' });
    expect(timeseries.ok && timeseries.query).toContain('interval=day');

    const unanswered = buildAnalyticsQuery({ ...range, limit: 10 });
    expect(unanswered.ok && unanswered.query).toContain('limit=10');
  });

  it('rejects invalid filters the API would reject too', () => {
    expect(buildAnalyticsQuery({ from: 'yesterday', to: range.to }).ok).toBe(false);
    expect(buildAnalyticsQuery({ ...range, inboxId: 0 }).ok).toBe(false);
    expect(buildAnalyticsQuery({ ...range, limit: 99 }).ok).toBe(false);
    expect(buildAnalyticsQuery({ ...range, interval: 'hour' as unknown as 'day' }).ok).toBe(false);
  });
});

describe('formatters', () => {
  it('formats rates as percentages', () => {
    expect(formatRate(0.756)).toBe('75.6%');
    expect(formatRate(0)).toBe('0.0%');
  });

  it('formats latencies in ms or seconds', () => {
    expect(formatLatencyMs(0)).toBe('—');
    expect(formatLatencyMs(812.5)).toBe('813 ms');
    expect(formatLatencyMs(2500)).toBe('2.50 s');
  });

  it('formats costs for small amounts', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(1.234)).toBe('$1.23');
  });

  it('groups counts and labels buckets in UTC', () => {
    expect(formatCount(12_000)).toBe('12,000');
    expect(bucketLabel('2026-10-17T00:00:00.000Z', 'day')).toBe('Oct 17');
    expect(bucketLabel('2026-10-12T00:00:00.000Z', 'week')).toBe('Week of Oct 12');
    expect(bucketLabel('2026-10-01T00:00:00.000Z', 'month')).toBe('Oct 2026');
    expect(formatTimestamp('2026-10-18T09:30:00.000Z')).toBe('2026-10-18 09:30 UTC');
  });
});
