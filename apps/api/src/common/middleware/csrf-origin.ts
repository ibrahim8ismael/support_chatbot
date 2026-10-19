import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SAFE_FETCH_SITES = new Set(['same-origin', 'same-site', 'none']);

/**
 * Defense-in-depth cross-site request guard for cookie-authenticated writes
 * (audit P3). `SameSite=Lax` already blocks the classic browser CSRF for POST
 * requests; this middleware additionally rejects requests whose `Origin` or
 * `Sec-Fetch-Site` headers name another site. It only acts on evidence a
 * browser supplies — CLI clients, webhooks and tests send neither header and
 * stay unblocked.
 */
export function csrfOriginMiddleware(appUrl: string) {
  const allowedOrigin = new URL(appUrl).origin;

  return (request: Request, response: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(request.method)) {
      next();
      return;
    }

    const fetchSite = request.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string' && !SAFE_FETCH_SITES.has(fetchSite)) {
      response
        .status(403)
        .json({ statusCode: 403, error: 'Forbidden', message: 'Cross-site request blocked' });
      return;
    }

    const origin = request.headers.origin;
    if (typeof origin === 'string' && origin !== allowedOrigin) {
      response
        .status(403)
        .json({ statusCode: 403, error: 'Forbidden', message: 'Cross-site request blocked' });
      return;
    }

    next();
  };
}
