import type { Request } from 'express';

import type { SessionUser } from '@support-agent/shared';

/** Request after AuthGuard ran (`request.user` is set on non-@Public routes). */
export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
  sessionId?: string;
}

export interface LoginMeta {
  ip?: string;
  userAgent?: string;
}

export interface LoginResult {
  user: SessionUser;
  sessionId: string;
}
