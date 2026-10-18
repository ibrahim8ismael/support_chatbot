import { describe, expect, it } from 'vitest';

import { auditLogQuerySchema } from '@support-agent/shared';

describe('audit log query schema', () => {
  it('applies pagination defaults and accepts an empty query', () => {
    expect(auditLogQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it('keeps filters and coerces paging', () => {
    expect(
      auditLogQuerySchema.parse({
        userId: 'bbbbbbbb-2222-4222-8222-222222222222',
        action: 'users.update',
        from: '2026-10-11T00:00:00.000Z',
        to: '2026-10-18T00:00:00.000Z',
        limit: '10',
        offset: '20',
      }),
    ).toEqual({
      userId: 'bbbbbbbb-2222-4222-8222-222222222222',
      action: 'users.update',
      from: '2026-10-11T00:00:00.000Z',
      to: '2026-10-18T00:00:00.000Z',
      limit: 10,
      offset: 20,
    });
  });

  it('rejects unknown keys, non-uuid users and out-of-bounds paging', () => {
    expect(auditLogQuerySchema.safeParse({ entity: 'user' }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ userId: 'ada' }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ action: '   ' }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  });
});
