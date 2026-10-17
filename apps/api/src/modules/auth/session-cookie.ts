import type { CookieOptions, Request } from 'express';

import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from './auth.constants';

/**
 * httpOnly + sameSite=lax always; `secure` only outside development
 * (localhost is plain http) — docs/operations/security.md § 1.
 */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

export function getSessionCookie(request: Request): string | undefined {
  const cookies = (request as Request & { cookies?: Record<string, string | undefined> }).cookies;
  return cookies?.[SESSION_COOKIE_NAME];
}
