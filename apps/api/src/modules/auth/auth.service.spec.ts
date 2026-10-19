import { HttpException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { SessionUser, UserRole } from '@support-agent/shared';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { DatabaseService } from '../../db/database.service';
import type { AnalyticsService } from '../analytics/analytics.service';
import type { CacheService } from '../infra/cache.service';
import { LOGIN_BURST_LIMIT, LOGIN_IP_LIMIT, LOGIN_MAX_FAILURES } from './auth.constants';
import { AuthService } from './auth.service';
import type { PasswordService } from './password.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const FAIL_KEY = 'login:fail:user@example.com';

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

interface SessionRow {
  sessionId: string;
  expiresAt: Date;
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

const USER_ROW: UserRow = {
  id: USER_ID,
  email: 'user@example.com',
  passwordHash: 'stored-hash',
  name: 'User',
  role: 'editor',
  isActive: true,
};

function buildHarness(
  options: {
    user?: UserRow | null;
    sessionRow?: SessionRow | null;
    cache?: Map<string, number>;
  } = {},
) {
  const userRow = options.user === undefined ? USER_ROW : options.user;
  const sessionRow = options.sessionRow ?? null;
  const cacheMap = options.cache ?? new Map<string, number>();

  const userLimit = vi.fn(async () => (userRow ? [userRow] : []));
  const sessionLimit = vi.fn(async () => (sessionRow ? [sessionRow] : []));

  // `select()` → users chain, `select({ ... })` → sessions chain.
  const select = vi.fn((selection?: Record<string, unknown>) => {
    const limit = selection ? sessionLimit : userLimit;
    return {
      from: () => ({
        where: (condition: unknown) => {
          void condition;
          return { limit };
        },
        innerJoin: () => ({ where: () => ({ limit }) }),
      }),
    };
  });

  const insertReturning = vi.fn(async () => [{ id: SESSION_ID }]);
  const insertValues = vi.fn((values: Record<string, unknown>) => {
    void values;
    return { returning: insertReturning };
  });
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateSet = vi.fn((values: Record<string, unknown>) => {
    void values;
    return { where: async () => [] };
  });
  const update = vi.fn(() => ({ set: updateSet }));

  const deleteWhere = vi.fn(async () => []);
  const remove = vi.fn(() => ({ where: deleteWhere }));

  const database = {
    db: { select, insert, update, delete: remove },
  } as unknown as DatabaseService;

  const cache = {
    get: vi.fn(async (key: string) => cacheMap.get(key)),
    set: vi.fn(async (key: string, value: number) => {
      cacheMap.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      cacheMap.delete(key);
    }),
    incrWithTtl: vi.fn(async (key: string) => {
      const next = (cacheMap.get(key) ?? 0) + 1;
      cacheMap.set(key, next);
      return next;
    }),
  } as unknown as CacheService;

  const verify = vi.fn(
    async (hash: string, password: string) =>
      password === 'correct-password' && hash === USER_ROW.passwordHash,
  );
  const passwords = { hash: vi.fn(async () => 'hash'), verify } as unknown as PasswordService;

  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as AppLogger;

  const recordAuditLog = vi.fn(async (_input: unknown) => undefined);
  const analytics = { recordAuditLog } as unknown as AnalyticsService;

  const service = new AuthService(database, cache, passwords, analytics, logger);
  return {
    service,
    cacheMap,
    select,
    insertValues,
    deleteWhere,
    verify,
    updateSet,
    recordAuditLog,
  };
}

/** Resolves to the rejection reason (or throws when it unexpectedly resolves). */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    throw new Error('expected the promise to reject');
  } catch (error) {
    return error;
  }
}

async function statusOf(promise: Promise<unknown>): Promise<number | undefined> {
  const error = await failureOf(promise);
  return error instanceof HttpException ? error.getStatus() : undefined;
}

describe('AuthService.login', () => {
  it('issues a session for valid credentials and clears the failure counter', async () => {
    const harness = buildHarness();

    const result = await harness.service.login('User@Example.com', 'correct-password', {
      ip: '1.2.3.4',
      userAgent: 'vitest',
    });

    const expectedUser: SessionUser = {
      id: USER_ROW.id,
      email: USER_ROW.email,
      name: USER_ROW.name,
      role: 'editor',
    };
    expect(result.user).toEqual(expectedUser);
    expect(result.sessionId).toBe(SESSION_ID);

    const inserted = harness.insertValues.mock.calls[0]?.[0] as { userId: string; expiresAt: Date };
    expect(inserted.userId).toBe(USER_ID);
    expect(inserted.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Counters keyed by lowercased email; cleared on success.
    expect(harness.cacheMap.has(FAIL_KEY)).toBe(false);
  });

  it('rejects a wrong password, counts the failure and delays the answer', async () => {
    const harness = buildHarness();
    const started = Date.now();

    await expect(
      harness.service.login('user@example.com', 'wrong-password', {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(harness.cacheMap.get(FAIL_KEY)).toBe(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100); // loginDelayMs(1)
  });

  it('increments the failure counter for repeat offenders', async () => {
    const harness = buildHarness({ cache: new Map([[FAIL_KEY, 3]]) });

    await expect(
      harness.service.login('user@example.com', 'wrong-password', {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(harness.cacheMap.get(FAIL_KEY)).toBe(4);
  });

  it('locks the account at the threshold without checking the password', async () => {
    const harness = buildHarness({ cache: new Map([[FAIL_KEY, LOGIN_MAX_FAILURES]]) });

    expect(await statusOf(harness.service.login('user@example.com', 'correct-password', {}))).toBe(
      429,
    );
    expect(harness.verify).not.toHaveBeenCalled();
  });

  it('rate limits per IP before touching the database', async () => {
    const harness = buildHarness({ cache: new Map([['login:ip:9.9.9.9', LOGIN_IP_LIMIT]]) });

    expect(
      await statusOf(
        harness.service.login('user@example.com', 'correct-password', { ip: '9.9.9.9' }),
      ),
    ).toBe(429);
    expect(harness.select).not.toHaveBeenCalled();
  });

  it('caps parallel attempts per account with the burst limiter', async () => {
    const harness = buildHarness({
      cache: new Map([['login:burst:user@example.com', LOGIN_BURST_LIMIT]]),
    });

    expect(await statusOf(harness.service.login('user@example.com', 'correct-password', {}))).toBe(
      429,
    );
    expect(harness.verify).not.toHaveBeenCalled();
  });

  it('rejects unknown emails and still verifies against the dummy hash', async () => {
    const harness = buildHarness({ user: null });

    await expect(
      harness.service.login('ghost@example.com', 'correct-password', {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(harness.verify).toHaveBeenCalledOnce();
    expect(harness.verify.mock.calls[0]?.[0]).toMatch(/^\$argon2id\$/);
    expect(harness.cacheMap.get('login:fail:ghost@example.com')).toBe(1);
  });

  it('treats deactivated users as invalid credentials', async () => {
    const harness = buildHarness({ user: { ...USER_ROW, isActive: false } });

    await expect(
      harness.service.login('user@example.com', 'correct-password', {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('audits a successful login with the session id', async () => {
    const harness = buildHarness();

    await harness.service.login('user@example.com', 'correct-password', { ip: '1.2.3.4' });

    expect(harness.recordAuditLog).toHaveBeenCalledWith({
      userId: USER_ID,
      action: 'auth.login',
      entity: 'session',
      entityId: SESSION_ID,
      data: { ip: '1.2.3.4', userAgent: null },
    });
  });

  it('audits failed logins with a reason and no password material', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.login('user@example.com', 'wrong-password', { ip: '1.2.3.4' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(harness.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        action: 'auth.login_failed',
        entity: 'session',
        data: expect.objectContaining({
          email: 'user@example.com',
          reason: 'bad_password',
          ip: '1.2.3.4',
        }),
      }),
    );
  });

  it('audits account lockouts and IP rate limits without an actor', async () => {
    const locked = buildHarness({ cache: new Map([[FAIL_KEY, LOGIN_MAX_FAILURES]]) });

    await statusOf(locked.service.login('user@example.com', 'correct-password', {}));

    expect(locked.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        action: 'auth.login_failed',
        data: expect.objectContaining({ reason: 'account_locked' }),
      }),
    );

    const limited = buildHarness({ cache: new Map([['login:ip:9.9.9.9', LOGIN_IP_LIMIT]]) });

    await statusOf(
      limited.service.login('user@example.com', 'correct-password', { ip: '9.9.9.9' }),
    );

    expect(limited.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        action: 'auth.login_failed',
        data: expect.objectContaining({ reason: 'ip_rate_limited' }),
      }),
    );
  });
});

describe('AuthService.resolveSession', () => {
  const SESSION_ROW: SessionRow = {
    sessionId: SESSION_ID,
    expiresAt: new Date(Date.now() + 60_000),
    userId: USER_ID,
    email: USER_ROW.email,
    name: USER_ROW.name,
    role: 'admin',
    isActive: true,
  };

  it('returns the user for a valid session', async () => {
    const harness = buildHarness({ sessionRow: SESSION_ROW });

    await expect(harness.service.resolveSession(SESSION_ID)).resolves.toEqual({
      id: USER_ID,
      email: USER_ROW.email,
      name: USER_ROW.name,
      role: 'admin',
    });
  });

  it('deletes expired sessions and returns null', async () => {
    const harness = buildHarness({
      sessionRow: { ...SESSION_ROW, expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(harness.service.resolveSession(SESSION_ID)).resolves.toBeNull();
    expect(harness.deleteWhere).toHaveBeenCalledOnce();
  });

  it('ignores malformed cookie values without a query', async () => {
    const harness = buildHarness();

    await expect(harness.service.resolveSession('not-a-uuid')).resolves.toBeNull();
    await expect(harness.service.resolveSession(undefined)).resolves.toBeNull();
    expect(harness.select).not.toHaveBeenCalled();
  });

  it('rejects sessions of deactivated users', async () => {
    const harness = buildHarness({ sessionRow: { ...SESSION_ROW, isActive: false } });

    await expect(harness.service.resolveSession(SESSION_ID)).resolves.toBeNull();
  });
});

describe('AuthService.logout', () => {
  it('deletes the session row', async () => {
    const harness = buildHarness();

    await harness.service.logout(SESSION_ID);

    expect(harness.deleteWhere).toHaveBeenCalledOnce();
  });

  it('is a no-op for malformed ids', async () => {
    const harness = buildHarness();

    await harness.service.logout('garbage');

    expect(harness.deleteWhere).not.toHaveBeenCalled();
  });

  it('audits logout with the session owner', async () => {
    const harness = buildHarness({
      sessionRow: {
        sessionId: SESSION_ID,
        expiresAt: new Date(Date.now() + 60_000),
        userId: USER_ID,
        email: USER_ROW.email,
        name: USER_ROW.name,
        role: 'editor',
        isActive: true,
      },
    });

    await harness.service.logout(SESSION_ID, { ip: '1.2.3.4' });

    expect(harness.deleteWhere).toHaveBeenCalledOnce();
    expect(harness.recordAuditLog).toHaveBeenCalledWith({
      userId: USER_ID,
      action: 'auth.logout',
      entity: 'session',
      entityId: SESSION_ID,
      data: { ip: '1.2.3.4', userAgent: null },
    });
  });
});
