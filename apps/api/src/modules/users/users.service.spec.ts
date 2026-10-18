import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseService } from '../../db/database.service';
import type { AnalyticsService } from '../analytics/analytics.service';
import type { AuthService } from '../auth/auth.service';
import type { PasswordService } from '../auth/password.service';
import { UsersService } from './users.service';

const USER_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ada@example.com',
  passwordHash: 'argon2-hash',
  name: 'Ada',
  role: 'editor' as const,
  isActive: true,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  updatedAt: new Date('2026-10-02T10:00:00Z'),
};

interface HarnessOptions {
  listRows?: Array<typeof USER_ROW>;
  insertedRow?: typeof USER_ROW | null;
  updatedRow?: typeof USER_ROW | null;
  passwordRow?: { id: string; email: string } | null;
}

function buildHarness(options: HarnessOptions = {}) {
  const orderBy = vi.fn(async () => options.listRows ?? [USER_ROW]);
  const select = vi.fn(() => ({ from: () => ({ orderBy }) }));

  const insertReturning = vi.fn(async () =>
    options.insertedRow === null ? [] : [options.insertedRow ?? USER_ROW],
  );
  const onConflictDoNothing = vi.fn(() => ({ returning: insertReturning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));

  const updateReturning = vi.fn(async (selection?: unknown) => {
    if (selection !== undefined) {
      return options.passwordRow === null
        ? []
        : [options.passwordRow ?? { id: USER_ROW.id, email: USER_ROW.email }];
    }
    return options.updatedRow === null ? [] : [options.updatedRow ?? USER_ROW];
  });
  const set = vi.fn(() => ({ where: () => ({ returning: updateReturning }) }));
  const update = vi.fn(() => ({ set }));

  const database = { db: { insert, select, update } } as unknown as DatabaseService;
  const passwords = {
    hash: vi.fn(async (password: string) => `hashed:${password}`),
  } as unknown as PasswordService;
  const auth = { invalidateSessions: vi.fn(async () => {}) } as unknown as AuthService;
  const analytics = { recordAuditLog: vi.fn(async () => {}) } as unknown as AnalyticsService;

  return {
    service: new UsersService(database, passwords, auth, analytics),
    values,
    set,
    passwords,
    auth,
    analytics,
  };
}

describe('UsersService.list', () => {
  it('maps rows to summaries with ISO timestamps', async () => {
    const harness = buildHarness();

    await expect(harness.service.list()).resolves.toEqual([
      {
        id: USER_ROW.id,
        email: 'ada@example.com',
        name: 'Ada',
        role: 'editor',
        isActive: true,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-02T10:00:00.000Z',
      },
    ]);
  });
});

describe('UsersService.create', () => {
  it('hashes the password, inserts and audits the actor', async () => {
    const harness = buildHarness();

    const created = await harness.service.create(
      { email: 'ada@example.com', name: 'Ada', role: 'editor', password: 'correct horse battery' },
      'actor-1',
    );

    expect(created.email).toBe('ada@example.com');
    expect(harness.values).toHaveBeenCalledWith({
      email: 'ada@example.com',
      name: 'Ada',
      role: 'editor',
      passwordHash: 'hashed:correct horse battery',
    });
    expect(harness.analytics.recordAuditLog).toHaveBeenCalledWith({
      userId: 'actor-1',
      action: 'users.create',
      entity: 'user',
      entityId: USER_ROW.id,
      data: { email: 'ada@example.com', name: 'Ada', role: 'editor' },
    });
  });

  it('rejects duplicate emails with 409', async () => {
    const harness = buildHarness({ insertedRow: null });

    await expect(
      harness.service.create(
        {
          email: 'ada@example.com',
          name: 'Ada',
          role: 'editor',
          password: 'correct horse battery',
        },
        'actor-1',
      ),
    ).rejects.toThrow(ConflictException);
    expect(harness.analytics.recordAuditLog).not.toHaveBeenCalled();
  });
});

describe('UsersService.update', () => {
  it('patches only the provided fields and audits', async () => {
    const harness = buildHarness();

    await harness.service.update(USER_ROW.id, { role: 'viewer' }, 'actor-1');

    expect(harness.set).toHaveBeenCalledWith({ role: 'viewer' });
    expect(harness.auth.invalidateSessions).not.toHaveBeenCalled();
    expect(harness.analytics.recordAuditLog).toHaveBeenCalledWith({
      userId: 'actor-1',
      action: 'users.update',
      entity: 'user',
      entityId: USER_ROW.id,
      data: { email: 'ada@example.com', patch: { role: 'viewer' } },
    });
  });

  it('drops every session when the account is deactivated', async () => {
    const harness = buildHarness();

    await harness.service.update(USER_ROW.id, { isActive: false }, 'actor-1');

    expect(harness.set).toHaveBeenCalledWith({ isActive: false });
    expect(harness.auth.invalidateSessions).toHaveBeenCalledWith(USER_ROW.id);
  });

  it('404s unknown users and 400s empty patches from direct callers', async () => {
    await expect(
      buildHarness({ updatedRow: null }).service.update(USER_ROW.id, { name: 'X' }, 'actor-1'),
    ).rejects.toThrow(NotFoundException);

    await expect(buildHarness().service.update(USER_ROW.id, {}, 'actor-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('UsersService.resetPassword', () => {
  it('stores the new hash, kills sessions and audits', async () => {
    const harness = buildHarness();

    await harness.service.resetPassword(USER_ROW.id, 'correct horse battery', 'actor-1');

    expect(harness.set).toHaveBeenCalledWith({ passwordHash: 'hashed:correct horse battery' });
    expect(harness.auth.invalidateSessions).toHaveBeenCalledWith(USER_ROW.id);
    expect(harness.analytics.recordAuditLog).toHaveBeenCalledWith({
      userId: 'actor-1',
      action: 'users.password_reset',
      entity: 'user',
      entityId: USER_ROW.id,
      data: { email: 'ada@example.com' },
    });
  });

  it('404s unknown users without touching sessions', async () => {
    const harness = buildHarness({ passwordRow: null });

    await expect(
      harness.service.resetPassword(USER_ROW.id, 'correct horse battery', 'actor-1'),
    ).rejects.toThrow(NotFoundException);
    expect(harness.auth.invalidateSessions).not.toHaveBeenCalled();
  });
});
