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
