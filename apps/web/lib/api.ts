import type { HealthResponse } from '@support-agent/shared';

/** Nest API origin — docker/dev default. The /api prefix is added below. */
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const API_BASE_URL = `${API_ORIGIN}/api`;

/** API failure carrying the HTTP status — 401 maps to the login redirect. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Nest error bodies carry a `message` (string or zod issue list). */
async function apiError(response: Response, path: string): Promise<ApiError> {
  let detail = '';
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string' && body.message.length > 0) {
      detail = body.message;
    } else if (Array.isArray(body.message)) {
      detail = body.message.join('; ');
    }
  } catch {
    // Not JSON — fall through to the generic message.
  }
  return new ApiError(
    response.status,
    detail || `API ${response.status} ${response.statusText}: ${path}`,
  );
}

/**
 * Cookie-authenticated JSON fetch against the API (server-side session cookie —
 * docs/operations/security.md). Errors surface as thrown `ApiError`s; callers
 * decide what to show (and whether to send the user back to /login).
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    throw await apiError(response, path);
  }

  return (await response.json()) as T;
}

/** Multipart upload — the browser sets the multipart content type + boundary. */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    body,
  });

  if (!response.ok) {
    throw await apiError(response, path);
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
