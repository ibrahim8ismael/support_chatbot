import { describe, expect, it, vi } from 'vitest';

import type { UserSummary } from '@support-agent/shared';

import { UsersController } from './users.controller';
import type { UsersService } from './users.service';

const ADMIN = {
  id: '99999999-9999-4999-8999-999999999999',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin' as const,
};

const USER: UserSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ada@example.com',
  name: 'Ada',
  role: 'editor',
  isActive: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
};

function buildHarness() {
  const list = vi.fn(async () => [USER]);
  const create = vi.fn(async (_input: unknown, _actorId: string) => USER);
  const update = vi.fn(async (_id: string, _input: unknown, _actorId: string) => USER);
  const resetPassword = vi.fn(async (_id: string, _password: string, _actorId: string) => {});
  const service = { list, create, update, resetPassword } as unknown as UsersService;

  return {
    controller: new UsersController(service),
    list,
    create,
    update,
    resetPassword,
  };
}

describe('UsersController', () => {
  it('lists users', async () => {
    const { controller, list } = buildHarness();

    await expect(controller.list()).resolves.toEqual([USER]);
    expect(list).toHaveBeenCalledOnce();
  });

  it('creates with the parsed body and attributes the actor', async () => {
    const { controller, create } = buildHarness();
    const body = {
      email: 'ada@example.com',
      name: 'Ada',
      role: 'editor' as const,
      password: 'correct horse battery',
    };

    await expect(controller.create(body, ADMIN)).resolves.toEqual(USER);
    expect(create).toHaveBeenCalledWith(body, ADMIN.id);
  });

  it('updates with the parsed patch and attributes the actor', async () => {
    const { controller, update } = buildHarness();

    await expect(controller.update(USER.id, { role: 'viewer' }, ADMIN)).resolves.toEqual(USER);
    expect(update).toHaveBeenCalledWith(USER.id, { role: 'viewer' }, ADMIN.id);
  });

  it('resets a password and reports ok', async () => {
    const { controller, resetPassword } = buildHarness();

    await expect(
      controller.resetPassword(USER.id, { password: 'correct horse battery' }, ADMIN),
    ).resolves.toEqual({ status: 'ok' });
    expect(resetPassword).toHaveBeenCalledWith(USER.id, 'correct horse battery', ADMIN.id);
  });
});
