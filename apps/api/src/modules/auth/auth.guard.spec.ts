import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { SessionUser } from '@support-agent/shared';

import { AuthGuard } from './auth.guard';
import type { AuthService } from './auth.service';

const SESSION_USER: SessionUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  name: 'User',
  role: 'admin',
};

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildGuard(options: { isPublic: boolean; user?: SessionUser | null }) {
  const reflector = {
    getAllAndOverride: vi.fn(() => options.isPublic),
  } as unknown as Reflector;
  const auth = {
    resolveSession: vi.fn(async () => options.user ?? null),
  } as unknown as AuthService;
  return { guard: new AuthGuard(auth, reflector), auth };
}

describe('AuthGuard', () => {
  it('lets @Public routes through without a session', async () => {
    const { guard, auth } = buildGuard({ isPublic: true });

    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    expect(auth.resolveSession).not.toHaveBeenCalled();
  });

  it('rejects requests without a valid session', async () => {
    const { guard } = buildGuard({ isPublic: false, user: null });

    await expect(guard.canActivate(contextFor({ cookies: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the user and session id on a valid cookie', async () => {
    const { guard, auth } = buildGuard({ isPublic: false, user: SESSION_USER });
    const request: Record<string, unknown> = {
      cookies: { support_agent_session: 'session-id' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(auth.resolveSession).toHaveBeenCalledWith('session-id');
    expect(request.user).toEqual(SESSION_USER);
    expect(request.sessionId).toBe('session-id');
  });
});
