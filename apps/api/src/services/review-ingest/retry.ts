/**
 * Transient-failure retry for the review-ingest slice: DB writes and other
 * fallible stage steps wrap their work in {@link retryTransient} so a deadlock,
 * connection drop, or lock timeout is retried with exponential back-off instead
 * of failing the whole review.
 */

import type { Logger } from '@harness/di';

/**
 * Retry a transient operation with exponential back-off (up to `maxAttempts`
 * tries). DB deadlocks, connection drops, and lock timeouts are considered
 * transient; business errors (not-found, validation) are not retried.
 */
export async function retryTransient<T>(
  label: string,
  fn: () => Promise<T>,
  logger: Logger,
  reportId: string,
  maxAttempts = 3,
  baseMs = 200,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isTransient =
        error instanceof Error && /deadlock|lock timeout|connection|ECONNRESET|ETIMEDOUT/i.test(error.message);
      if (!isTransient || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = baseMs * 2 ** (attempt - 1);
      logger.warn(`${label} transient failure, retrying`, {
        report_id: reportId,
        attempt,
        maxAttempts,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable — the loop always either returns or throws.
  throw new Error(`${label} retry exhausted`);
}
