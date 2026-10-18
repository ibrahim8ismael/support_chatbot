import { describe, expect, it } from 'vitest';

import {
  analyticsQuerySchema,
  analyticsTimeseriesQuerySchema,
  analyticsUnansweredQuerySchema,
} from '@support-agent/shared';

describe('analytics query schemas', () => {
  it('accepts an empty query (defaults applied downstream)', () => {
    expect(analyticsQuerySchema.parse({})).toEqual({});
  });

  it('coerces inboxId and keeps ISO datetimes', () => {
    expect(
      analyticsQuerySchema.parse({
        from: '2026-10-11T00:00:00.000Z',
        to: '2026-10-18T00:00:00.000Z',
        inboxId: '3',
      }),
    ).toEqual({
      from: '2026-10-11T00:00:00.000Z',
      to: '2026-10-18T00:00:00.000Z',
      inboxId: 3,
    });
  });

  it('rejects unknown keys, bad datetimes and non-numeric inbox ids', () => {
    expect(analyticsQuerySchema.safeParse({ interval: 'day' }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ inboxId: 'abc' }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ inboxId: '0' }).success).toBe(false);
  });

  it('defaults the timeseries interval to day and rejects unknown ones', () => {
    expect(analyticsTimeseriesQuerySchema.parse({}).interval).toBe('day');
    expect(analyticsTimeseriesQuerySchema.parse({ interval: 'month' }).interval).toBe('month');
    expect(analyticsTimeseriesQuerySchema.safeParse({ interval: 'hour' }).success).toBe(false);
  });

  it('defaults the unanswered limit to 10 and bounds it to 1..50', () => {
    expect(analyticsUnansweredQuerySchema.parse({}).limit).toBe(10);
    expect(analyticsUnansweredQuerySchema.parse({ limit: '25' }).limit).toBe(25);
    expect(analyticsUnansweredQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(analyticsUnansweredQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });
});
