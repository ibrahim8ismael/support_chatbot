import { describe, expect, it } from 'vitest';

import {
  BOT_STATE_LABELS,
  buildConversationListQuery,
  formatScore,
  isEscalationOutcome,
  pageRangeLabel,
} from './conversations';

describe('buildConversationListQuery', () => {
  it('applies the shared defaults for an empty input', () => {
    expect(buildConversationListQuery({})).toEqual({ ok: true, query: 'limit=50&offset=0' });
  });

  it('serializes filters in schema order, coercing to strings', () => {
    const result = buildConversationListQuery({
      inboxId: 3,
      botState: 'paused',
      from: '2026-10-11T00:00:00.000Z',
      to: '2026-10-18T00:00:00.000Z',
      limit: 10,
      offset: 20,
    });

    expect(result).toEqual({
      ok: true,
      query:
        'inboxId=3&botState=paused&from=2026-10-11T00%3A00%3A00.000Z&to=2026-10-18T00%3A00%3A00.000Z&limit=10&offset=20',
    });
  });

  it('reports the first schema issue for invalid input', () => {
    const result = buildConversationListQuery({ botState: 'sleeping' as never });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });
});

describe('conversation display helpers', () => {
  it('labels every bot state', () => {
    expect(BOT_STATE_LABELS).toEqual({
      active: 'Active',
      paused: 'Paused',
      handed_off: 'Handed off',
    });
  });

  it('formats scores with an em dash fallback', () => {
    expect(formatScore(0.812)).toBe('0.81');
    expect(formatScore(1)).toBe('1.00');
    expect(formatScore(null)).toBe('—');
  });

  it('recognizes escalation outcomes', () => {
    expect(isEscalationOutcome('escalated_low_score')).toBe(true);
    expect(isEscalationOutcome('escalated_request')).toBe(true);
    expect(isEscalationOutcome('answered')).toBe(false);
    expect(isEscalationOutcome('error')).toBe(false);
  });

  it('labels the visible page slice', () => {
    expect(pageRangeLabel(0, 3, 3)).toBe('1–3 of 3');
    expect(pageRangeLabel(50, 50, 240)).toBe('51–100 of 240');
    expect(pageRangeLabel(100, 0, 100)).toBe('0 of 100');
  });
});
