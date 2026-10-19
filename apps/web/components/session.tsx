'use client';

import { createContext, useContext } from 'react';

import type { SessionUser, UserRole } from '@support-agent/shared';

/**
 * Session user from the dashboard shell's `/auth/me` probe. `null` means the
 * probe has not answered yet (or failed): role-gated UI must treat null as "no
 * rights", so viewers never see controls that exist only to 403 (frontend
 * audit P2).
 */
const SessionContext = createContext<SessionUser | null>(null);

export const SessionProvider = SessionContext.Provider;

export function useSessionUser(): SessionUser | null {
  return useContext(SessionContext);
}

/** Editors and admins may change knowledge bases, bindings and settings. */
export function canWrite(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'editor';
}
