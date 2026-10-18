import { describe, expect, it } from 'vitest';

import { conversationListQuerySchema } from '@support-agent/shared';

describe('conversation list query schema', () => {
  it('applies pagination defaults and accepts an empty query', () => {
    expect(conversationListQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it('coerces inboxId and keeps the filters', () => {
    expect(
      conversationListQuerySchema.parse({
        inboxId: '3',
        botState: 'handed_off',
        from: '2026-10-11T00:00:00.000Z',
        to: '2026-10-18T00:00:00.000Z',
        limit: '10',
        offset: '20',
      }),
    ).toEqual({
      inboxId: 3,
      botState: 'handed_off',
      from: '2026-10-11T00:00:00.000Z',
      to: '2026-10-18T00:00:00.000Z',
      limit: 10,
      offset: 20,
    });
  });

  it('rejects unknown keys, bad enums/datetimes and out-of-bounds paging', () => {
    expect(conversationListQuerySchema.safeParse({ state: 'active' }).success).toBe(false);
    expect(conversationListQuerySchema.safeParse({ botState: 'sleeping' }).success).toBe(false);
    expect(conversationListQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
    expect(conversationListQuerySchema.safeParse({ inboxId: '0' }).success).toBe(false);
    expect(conversationListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(conversationListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(conversationListQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  });
});
