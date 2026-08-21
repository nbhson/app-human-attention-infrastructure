/**
 * Retry policy: exponential backoff with jitter (day-10 §2.2).
 *
 * `computeDelay` builds the backoff for a given 1-based `attempt`:
 * `baseDelayMs * 2^(attempt - 1)`, capped at `maxDelayMs`, then perturbed by a
 * ±`jitterFactor` factor and clamped back to `[0, maxDelayMs]` so jitter can
 * never push a delay past the ceiling.
 *
 * Jitter is not cosmetic: without it, N concurrent tasks all retry at the same
 * instant and thundering-herd the dependency. The ±20% default breaks that
 * synchronisation (day-10 §6).
 */

import type { ClassifiedFailure, FailureClass } from './failure-class.js';

export interface RetryPolicyConfig {
  /** Per-class retry budget: how many retries before escalation. */
  maxRetries: Record<FailureClass, number>;
  /** Backoff base; the first retry waits roughly this long. */
  baseDelayMs: number;
  /** Hard ceiling on any single delay. */
  maxDelayMs: number;
  /** Fraction of the delay added/subtracted as random jitter (0..1). */
  jitterFactor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxRetries: {
    TRANSIENT: 3,
    PERMANENT: 0, // never retry a permanent failure
    RESOURCE: 2,
  },
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitterFactor: 0.2,
};

/**
 * Compute the backoff for a 1-based `attempt`. Always in
 * `[0, config.maxDelayMs]` (jitter is clamped, not allowed to overflow the cap).
 */
export function computeDelay(attempt: number, config: RetryPolicyConfig): number {
  const exponential = Math.min(config.baseDelayMs * 2 ** (attempt - 1), config.maxDelayMs);
  const jitter = exponential * config.jitterFactor * (Math.random() * 2 - 1);
  const delay = Math.round(exponential + jitter);
  return Math.min(Math.max(delay, 0), config.maxDelayMs);
}

/** True when `attempt` (1-based) is within the retry budget for `failure.class`. */
export function shouldRetry(
  failure: ClassifiedFailure,
  attempt: number,
  config: RetryPolicyConfig,
): boolean {
  return attempt <= config.maxRetries[failure.class];
}
