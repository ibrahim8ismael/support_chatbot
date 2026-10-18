import { z } from 'zod';

/**
 * Audit-log read contract (docs/api/rest-api.md § Audit log — admin only).
 * The admin screen shares this schema so filters can't drift from the API.
 */

/** `GET /audit-logs` query — all filters optional; `from`/`to` are half-open. */
export const auditLogQuerySchema = z.strictObject({
  /** User who performed the action (uuid); events from anonymous flows have none. */
  userId: z.uuid().optional(),
  /** Exact action match (e.g. `auth.login`, `users.update`). */
  action: z.string().trim().min(1).max(120).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export interface AuditLogEntry {
  id: string;
  /** Null for anonymous events (e.g. failed logins). */
  userId: string | null;
  /** Denormalized for display; null when the user row is gone. */
  userEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  /** Event payload (jsonb) — shape depends on the action. */
  data: unknown;
  createdAt: string;
}

export interface AuditLogList {
  items: AuditLogEntry[];
  /** Total matching rows (before limit/offset). */
  total: number;
}
