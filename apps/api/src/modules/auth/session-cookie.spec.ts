import { describe, expect, it } from 'vitest';

import { SESSION_TTL_MS } from './auth.constants';
import { sessionCookieOptions } from './session-cookie';

describe('sessionCookieOptions', () => {
  it('is httpOnly + lax + 7d, non-secure in development', () => {
    expect(sessionCookieOptions(false)).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
  });

  it('adds secure in production (https only)', () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
  });
});
