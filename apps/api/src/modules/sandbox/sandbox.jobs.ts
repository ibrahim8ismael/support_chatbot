/**
 * BullMQ rejects custom job ids containing `:` (except for legacy repeatable
 * jobs). Keep sandbox ids opaque and URL-safe so enqueueing cannot fail on
 * valid run UUIDs.
 */
export function sandboxRunJobId(runId: string): string {
  return `sandbox-run-${runId}`;
}

/** Retries need a fresh id so a completed/failed job does not dedupe them. */
export function sandboxRetryJobId(runId: string, now: number = Date.now()): string {
  return `sandbox-run-${runId}-retry-${now}`;
}
