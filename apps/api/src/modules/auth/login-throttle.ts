import { LOGIN_MAX_FAILURES } from './auth.constants';

/** Failed attempts after which an account is temporarily locked. */
export function isLoginLocked(failures: number): boolean {
  return failures >= LOGIN_MAX_FAILURES;
}

/**
 * Exponential delay (ms) applied before answering a failed attempt:
 * 100, 200, 400, … capped at 1s. `failures` is the count including this one.
 */
export function loginDelayMs(failures: number): number {
  if (failures <= 0) {
    return 0;
  }
  return Math.min(100 * 2 ** (failures - 1), 1000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
