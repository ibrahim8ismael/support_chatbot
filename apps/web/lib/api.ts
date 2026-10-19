import type { HealthResponse } from '@support-agent/shared';

/** Nest API origin — docker/dev default. The /api prefix is added below. */
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const API_BASE_URL = `${API_ORIGIN}/api`;

/** Hard ceiling on a JSON request — spinners must never hang forever. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Uploads parse and embed server-side; they get a longer budget. */
const UPLOAD_TIMEOUT_MS = 120_000;

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

function isTimeout(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'TimeoutError';
}

function withTimeout(signal: AbortSignal | null | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Shared request runner: same-origin cookies, one timeout policy, and a friendly
 * error when the API never answers (aborted fetches surface as `ApiError(0)`).
 * Accepts an absolute URL for the few endpoints outside the /api prefix.
 */
async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const target = url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
  try {
    return await fetch(target, {
      ...init,
      credentials: 'include',
      signal: withTimeout(init.signal, timeoutMs),
    });
  } catch (cause) {
    if (isTimeout(cause)) {
      throw new ApiError(0, 'The API did not respond in time — check the server and try again.');
    }
    throw cause;
  }
}

/** `details` is `{ path, message }[]` from the API's zod pipe (rest-api.md). */
function formatDetails(details: unknown): string {
  if (!Array.isArray(details)) {
    return '';
  }
  return details
    .map((issue) => {
      if (issue === null || typeof issue !== 'object') {
        return '';
      }
      const { path, message } = issue as { path?: unknown; message?: unknown };
      if (typeof message !== 'string' || message.length === 0) {
        return '';
      }
      return typeof path === 'string' && path.length > 0 ? `${path}: ${message}` : message;
    })
    .filter((line) => line.length > 0)
    .join('; ');
}

/** Nest error bodies carry a `message` (string or zod issue list) + `details`. */
async function apiError(response: Response, path: string): Promise<ApiError> {
  let detail = '';
  try {
    const body = (await response.json()) as { message?: unknown; details?: unknown };
    if (typeof body.message === 'string' && body.message.length > 0) {
      detail = body.message;
    } else if (Array.isArray(body.message)) {
      detail = body.message.join('; ');
    }
    const issues = formatDetails(body.details);
    if (issues.length > 0) {
      detail = detail.length > 0 ? `${detail} — ${issues}` : issues;
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
  const headers = new Headers(init?.headers);
  // Only JSON requests carry the JSON content type; GETs don't need a preflight.
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await request(path, { ...init, headers }, REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    throw await apiError(response, path);
  }

  return (await response.json()) as T;
}

/** Multipart upload — the browser sets the multipart content type + boundary. */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file);

  const response = await request(path, { method: 'POST', body }, UPLOAD_TIMEOUT_MS);

  if (!response.ok) {
    throw await apiError(response, path);
  }

  return (await response.json()) as T;
}

/** `GET /health` lives outside the /api prefix (docs/api/rest-api.md). */
export async function getHealth(): Promise<HealthResponse> {
  const response = await request(`${API_ORIGIN}/health`, { method: 'GET' }, REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`API ${response.status} ${response.statusText}: /health`);
  }
  return (await response.json()) as HealthResponse;
}
