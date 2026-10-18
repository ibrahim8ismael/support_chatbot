import { describe, expect, it } from 'vitest';

import { USER_ROLE_LABELS, buildAuditQuery, describeAuditData } from './admin';

describe('buildAuditQuery', () => {
  it('applies the shared defaults for an empty input', () => {
    expect(buildAuditQuery({})).toEqual({ ok: true, query: 'limit=50&offset=0' });
  });

  it('serializes filters in schema order', () => {
    const result = buildAuditQuery({
      userId: 'bbbbbbbb-2222-4222-8222-222222222222',
      action: 'users.update',
      limit: 10,
      offset: 20,
    });

    expect(result).toEqual({
      ok: true,
      query: 'userId=bbbbbbbb-2222-4222-8222-222222222222&action=users.update&limit=10&offset=20',
    });
  });

  it('reports the first schema issue for invalid input', () => {
    const result = buildAuditQuery({ userId: 'ada' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });
});

describe('describeAuditData', () => {
  it('renders compact JSON and an em dash for empty payloads', () => {
    expect(describeAuditData({ ip: '127.0.0.1' })).toBe('{"ip":"127.0.0.1"}');
    expect(describeAuditData(null)).toBe('—');
    expect(describeAuditData(undefined)).toBe('—');
  });

  it('truncates long payloads and survives unserializable values', () => {
    const long = { value: 'x'.repeat(500) };
    const described = describeAuditData(long, 40);
    expect(described.length).toBe(40);
    expect(described.endsWith('…')).toBe(true);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(describeAuditData(cyclic)).toBe('—');
  });
});

describe('USER_ROLE_LABELS', () => {
  it('labels every role', () => {
    expect(USER_ROLE_LABELS).toEqual({ admin: 'Admin', editor: 'Editor', viewer: 'Viewer' });
  });
});
