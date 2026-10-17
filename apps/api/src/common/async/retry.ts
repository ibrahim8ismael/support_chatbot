/**
 * Retry a promise-returning call with exponential backoff. Ingestion uses
 * this for embedding batches: 3 attempts, 250ms → 500ms → 1s (pipeline doc).
 */
export interface RetryOptions {
  /** Total attempts including the first call. */
  attempts?: number;
  /** Delay after the first failure; doubles after each further failure. */
  baseDelayMs?: number;
  /** Invoked after a failure that will be retried (attempt = failed attempt). */
  onRetry?: (error: unknown, attempt: number) => void;
}

export async function withRetries<T>(
  run: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      options.onRetry?.(error, attempt);
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
