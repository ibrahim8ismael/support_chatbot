import { describe, expect, it } from 'vitest';

import { normalizeApiOrigin } from './api';

describe('normalizeApiOrigin', () => {
  it('defaults to same-origin when unset or blank', () => {
    expect(normalizeApiOrigin(undefined)).toBe('');
    expect(normalizeApiOrigin('')).toBe('');
    expect(normalizeApiOrigin('   ')).toBe('');
  });

  it('trims whitespace and trailing slashes', () => {
    expect(normalizeApiOrigin(' http://localhost:3001 ')).toBe('http://localhost:3001');
    expect(normalizeApiOrigin('https://support.example.com///')).toBe(
      'https://support.example.com',
    );
  });

  it('rejects values that are not an absolute http(s) origin', () => {
    expect(() => normalizeApiOrigin('localhost:3001')).toThrow(/http\(s\) origin/);
    expect(() => normalizeApiOrigin('ftp://api.example.com')).toThrow(/http\(s\) origin/);
    expect(() => normalizeApiOrigin('://nope')).toThrow(/http\(s\) origin/);
  });
});
