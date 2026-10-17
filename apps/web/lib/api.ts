import type { HealthResponse } from '@support-agent/shared';

/** Nest API origin — docker/dev default. The /api prefix is added below. */
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const API_BASE_URL = `${API_ORIGIN}/api`;

/**
 * Cookie-authenticated fetch against the API (server-side session cookie —
 * docs/operations/security.md). Errors surface as thrown exceptions; callers
 * decide what to show.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    throw new Error(`API ${response.status} ${response.statusText}: ${path}`);
  }

  return (await response.json()) as T;
}

/** `GET /health` lives outside the /api prefix (docs/api/rest-api.md). */
export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_ORIGIN}/health`);
  if (!response.ok) {
    throw new Error(`API ${response.status} ${response.statusText}: /health`);
  }
  return (await response.json()) as HealthResponse;
}
