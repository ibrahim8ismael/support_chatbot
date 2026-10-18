/**
 * Retention cleanup (T-403, NFR-7). A daily BullMQ job on the `maintenance`
 * queue deletes messages/conversations and analytics/audit events older than
 * `RETENTION_DAYS` (default 365). Documents, chunks, KBs, users and settings
 * are never touched — documents live until an editor deletes them (NFR-7).
 *
 * The helpers here are DB-free so the batching/ordering decisions unit-test
 * without Postgres; `retention.service.ts` supplies the drizzle-backed adapter.
 */
export const RETENTION_JOB_NAME = 'retention-cleanup';
/** Job-scheduler id — BullMQ upserts by id, so restarts never duplicate the schedule. */
export const RETENTION_SCHEDULER_ID = 'retention-cleanup';
/** Daily 03:00 UTC — off-peak for the single host. */
export const RETENTION_CRON = '0 3 * * *';
export const RETENTION_DAYS_DEFAULT = 365;
export const RETENTION_BATCH_SIZE = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionTarget {
  /** Table name; also the key in the result/log breakdown. */
  name: string;
  /** Trusted literal: `created_at` or the conversation's effective age. */
  ageColumn: string;
}

/**
 * FK-safe delete order: answer_events reference messages, messages reference
 * conversations — so events go first, then messages, then conversations.
 * `audit_logs` is independent. Documents/KBs are deliberately absent.
 */
export const RETENTION_TARGETS: readonly RetentionTarget[] = [
  { name: 'answer_events', ageColumn: 'created_at' },
  { name: 'messages', ageColumn: 'created_at' },
  { name: 'conversations', ageColumn: 'coalesce(last_message_at, created_at)' },
  { name: 'audit_logs', ageColumn: 'created_at' },
];

export interface RetentionTable {
  name: string;
  /** Delete up to `limit` rows older than `cutoff`; return the deleted count. */
  deleteBatch(cutoff: Date, limit: number): Promise<number>;
}

export interface RetentionResult {
  cutoff: string;
  deleted: Record<string, number>;
  total: number;
}

/** Start of the retention window: everything older than `now − days` goes. */
export function retentionCutoff(now: Date, days: number): Date {
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(`retention days must be a positive number (got ${days})`);
  }
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * Delete in batches until a short batch comes back — each DELETE stays small,
 * so a backlog never holds one huge transaction/row-lock on the table.
 */
export async function drainTable(
  table: RetentionTable,
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batch size must be a positive integer (got ${batchSize})`);
  }

  let deleted = 0;
  for (;;) {
    const count = await table.deleteBatch(cutoff, batchSize);
    deleted += count;
    if (count < batchSize) return deleted;
  }
}

export async function runRetention(
  tables: RetentionTable[],
  cutoff: Date,
  batchSize: number,
): Promise<RetentionResult> {
  const deleted: Record<string, number> = {};
  for (const table of tables) {
    deleted[table.name] = await drainTable(table, cutoff, batchSize);
  }
  const total = Object.values(deleted).reduce((sum, count) => sum + count, 0);
  return { cutoff: cutoff.toISOString(), deleted, total };
}

export function formatRetentionSummary(result: RetentionResult): string {
  const breakdown = Object.entries(result.deleted)
    .map(([name, count]) => `${name}=${count}`)
    .join(', ');
  return (
    `retention done: cutoff=${result.cutoff.slice(0, 10)} deleted=${result.total} ` +
    `(${breakdown}) — documents/KBs untouched`
  );
}
