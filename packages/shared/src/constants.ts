/** BullMQ queue names — ADR-0006. */
export const QUEUES = {
  reply: 'reply-job',
  ingestDocument: 'ingest-document',
  analyticsFollowup: 'analytics-followup',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Redis logical databases — ADR-0006: queue keys must never be evicted,
 * so queue (db 0) and cache (db 1) are separated.
 */
export const REDIS_DB_QUEUE = 0;
export const REDIS_DB_CACHE = 1;

/** Session cookie name (httpOnly, server-side session rows — docs/operations/security.md). */
export const SESSION_COOKIE_NAME = 'support_agent_session';

/** Global API route prefix. `/health` deliberately lives outside it. */
export const API_PREFIX = 'api';

/**
 * Embedding dimensions locked by decision D3 (`text-embedding-3-small` →
 * 1536) and by the `chunks.embedding vector(1536)` migration — changing the
 * embedding model means a new column + full re-embed.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/** FR-2: default maximum size per uploaded document (20 MB). */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Retrieval-cache invalidation counter per KB (docs/architecture/caching.md). */
export function kbVersionKey(kbId: string): string {
  return `kb:${kbId}:version`;
}
