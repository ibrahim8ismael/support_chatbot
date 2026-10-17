import { describe, expect, it } from 'vitest';

import { LOGIN_MAX_FAILURES } from './auth.constants';
import { isLoginLocked, loginDelayMs } from './login-throttle';

describe('loginDelayMs', () => {
  it('is 0 without failures', () => {
    expect(loginDelayMs(0)).toBe(0);
    expect(loginDelayMs(-1)).toBe(0);
  });

  it('doubles per failure counts', () => {
    expect(loginDelayMs(1)).toBe(100);
    expect(loginDelayMs(2)).toBe(200);
    expect(loginDelayMs(3)).toBe(400);
  });

  it('caps at 1s', () => {
    expect(loginDelayMs(5)).toBe(1000);
    expect(loginDelayMs(20)).toBe(1000);
  });
});

describe('isLoginLocked', () => {
  it('locks exactly at the threshold', () => {
    expect(isLoginLocked(LOGIN_MAX_FAILURES - 1)).toBe(false);
    expect(isLoginLocked(LOGIN_MAX_FAILURES)).toBe(true);
  });
});
