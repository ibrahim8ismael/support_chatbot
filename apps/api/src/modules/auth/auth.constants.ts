/**
 * Session cookie + login throttle constants — docs/operations/security.md § 1.
 */

/** httpOnly cookie holding the session row id. */
export const SESSION_COOKIE_NAME = 'support_agent_session';

/** Sliding 7-day expiry (data-model.md `sessions`). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Only rewrite `sessions.expires_at` when the last slide is older than this. */
export const SESSION_SLIDE_THRESHOLD_MS = 60 * 1000;

/** Failed logins per account before the account is temporarily locked. */
export const LOGIN_MAX_FAILURES = 8;
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;

/** Sign-in hits per IP inside the window (failures and successes alike). */
export const LOGIN_IP_LIMIT = 10;
export const LOGIN_IP_WINDOW_SECONDS = 60;

export const LOGIN_IP_BLOCKED_MESSAGE =
  'Too many sign-in attempts from this address. Try again shortly.';
export const LOGIN_LOCKED_MESSAGE = 'Too many failed sign-in attempts. Try again in 15 minutes.';
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
