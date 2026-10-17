import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { UserRole } from '@support-agent/shared';

import { IS_PUBLIC_KEY } from './auth.decorators';
import { RolesGuard } from './roles.guard';

function buildGuard(metadata: { isPublic?: boolean; roles?: UserRole[] }): RolesGuard {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) =>
      key === IS_PUBLIC_KEY ? metadata.isPublic : metadata.roles,
    ),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

function contextFor(role?: UserRole): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('defaults to admin when the endpoint declares no roles', () => {
    const guard = buildGuard({});

    expect(guard.canActivate(contextFor('admin'))).toBe(true);
    expect(() => guard.canActivate(contextFor('editor'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor('viewer'))).toThrow(ForbiddenException);
  });

  it('honours explicit @Roles metadata', () => {
    const guard = buildGuard({ roles: ['editor'] });

    expect(guard.canActivate(contextFor('editor'))).toBe(true);
    expect(() => guard.canActivate(contextFor('viewer'))).toThrow(ForbiddenException);
  });

  it('skips @Public routes entirely', () => {
    const guard = buildGuard({ isPublic: true });

    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });
});
