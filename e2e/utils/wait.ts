/**
 * Shared polling utility for E2E tests.
 *
 * Polls until `count()` reaches `expected` with timeout, exponential backoff,
 * and structured logging for CI debugging.
 */

export interface WaitForCountOptions {
  /** Maximum time to wait in milliseconds. Default: 30000 (30s) */
  timeoutMs?: number;
  /** Initial poll interval in milliseconds. Default: 50 */
  initialIntervalMs?: number;
  /** Maximum poll interval in milliseconds. Default: 1000 */
  maxIntervalMs?: number;
  /** Backoff multiplier. Default: 1.5 */
  backoffMultiplier?: number;
  /** Optional label for logging. */
  label?: string;
}

/**
 * Poll until `count()` reaches `expected`.
 *
 * @throws Error with detailed message if timeout is reached
 */
export async function waitForCount(
  count: () => Promise<number>,
  expected: number,
  options: WaitForCountOptions = {},
): Promise<void> {
  const {
    timeoutMs = 30000,
    initialIntervalMs = 50,
    maxIntervalMs = 1000,
    backoffMultiplier = 1.5,
    label = 'waitForCount',
  } = options;

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let interval = initialIntervalMs;

  for (;;) {
    attempt++;
    const n = await count();
    if (n >= expected) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `[${label}] timed out after ${attempt} attempts (${timeoutMs}ms) waiting for ${expected} row(s); saw ${n}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
    interval = Math.min(interval * backoffMultiplier, maxIntervalMs);
  }
}
