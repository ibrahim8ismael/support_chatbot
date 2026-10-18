import { auditLogQuerySchema, type UserRole } from '@support-agent/shared';

/**
 * Admin-UI helpers (T-304): user role labels, the audit-log query builder and
 * the audit data formatter. Query building goes through the shared schema the
 * API parses, so the screen and the API can't drift.
 */

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

export interface AuditQueryInput {
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/**
 * Validate + serialize audit filters with the shared schema (defaults
 * included). Empty strings must be omitted by the caller, not passed here.
 */
export function buildAuditQuery(
  input: AuditQueryInput,
): { ok: true; query: string } | { ok: false; error: string } {
  const parsed = auditLogQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid filters' };
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  return { ok: true, query: params.toString() };
}

/** Compact, truncated JSON for the audit table — `—` when there is no payload. */
export function describeAuditData(data: unknown, maxChars = 120): string {
  if (data == null) {
    return '—';
  }
  let text: string;
  try {
    text = JSON.stringify(data) ?? '—';
  } catch {
    return '—';
  }
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
