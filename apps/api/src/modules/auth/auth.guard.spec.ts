import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { SessionUser } from '@support-agent/shared';

import { SESSION_COOKIE_NAME } from './auth.constants';
import { AuthGuard } from './auth.guard';
import type { AuthService } from './auth.service';

const SESSION_USER: SessionUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  name: 'User',
  role: 'admin',
};

interface ResponseMock {
  cookie: ReturnType<typeof vi.fn>;
}

function buildContext(
  request: Record<string, unknown>,
  response: ResponseMock = { cookie: vi.fn() },
): { context: ExecutionContext; response: ResponseMock } {
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, response };
}

function buildGuard(options: {
  isPublic: boolean;
  session?: { user: SessionUser; slid: boolean } | null;
}) {
  const reflector = {
    getAllAndOverride: vi.fn(() => options.isPublic),
  } as unknown as Reflector;
  const auth = {
    resolveSession: vi.fn(async () => options.session ?? null),
  } as unknown as AuthService;
  const config = { get: vi.fn(() => 'test') } as unknown as ConfigService;
  return { guard: new AuthGuard(auth, reflector, config), auth };
}

describe('AuthGuard', () => {
  it('lets @Public routes through without a session', async () => {
    const { guard, auth } = buildGuard({ isPublic: true });
    const { context } = buildContext({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.resolveSession).not.toHaveBeenCalled();
  });

  it('rejects requests without a valid session', async () => {
    const { guard } = buildGuard({ isPublic: false, session: null });
    const { context } = buildContext({ cookies: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the user and session id on a valid cookie', async () => {
    const { guard, auth } = buildGuard({
      isPublic: false,
      session: { user: SESSION_USER, slid: false },
    });
    const request: Record<string, unknown> = {
      cookies: { support_agent_session: 'session-id' },
    };
    const { context, response } = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.resolveSession).toHaveBeenCalledWith('session-id');
    expect(request.user).toEqual(SESSION_USER);
    expect(request.sessionId).toBe('session-id');
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('re-issues the cookie when the session row slides', async () => {
    const { guard } = buildGuard({
      isPublic: false,
      session: { user: SESSION_USER, slid: true },
    });
    const request: Record<string, unknown> = {
      cookies: { support_agent_session: 'session-id' },
    };
    const { context, response } = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(response.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      'session-id',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
  });
});
