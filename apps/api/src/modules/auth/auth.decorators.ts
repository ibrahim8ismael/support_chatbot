import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

import type { SessionUser, UserRole } from '@support-agent/shared';

import type { AuthenticatedRequest } from './auth.types';

export const IS_PUBLIC_KEY = 'auth:public';

/** No session required (health, webhook, login/logout). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'auth:roles';

/** Allowed roles; endpoints without @Roles default to admin (security doc § 2). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new Error('CurrentUser used on a @Public route');
    }
    return request.user;
  },
);
