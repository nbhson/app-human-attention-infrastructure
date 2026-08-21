import { describe, expect, it } from 'vitest';

import { FailureClass } from '../retry/failure-class.js';
import type { ClassifiedFailure } from '../retry/failure-class.js';
import {
  DEFAULT_RETRY_POLICY,
  computeDelay,
  shouldRetry,
  type RetryPolicyConfig,
} from '../retry/retry-policy.js';

function failure(cls: ClassifiedFailure['class'], message = 'failure'): ClassifiedFailure {
  return { class: cls, message, raw: message };
}

/** The default backoff config but with jitter disabled, for exact assertions. */
const NO_JITTER: RetryPolicyConfig = { ...DEFAULT_RETRY_POLICY, jitterFactor: 0 };

describe('computeDelay', () => {
  it('computes roughly baseDelayMs on attempt 1, within jitter', () => {
    const { baseDelayMs, jitterFactor } = DEFAULT_RETRY_POLICY;
    const delta = baseDelayMs * jitterFactor;

    // Sample many times to exercise the random jitter across its range.
    for (let i = 0; i < 50; i += 1) {
      const delay = computeDelay(1, DEFAULT_RETRY_POLICY);
      expect(delay).toBeGreaterThanOrEqual(baseDelayMs - delta);
      expect(delay).toBeLessThanOrEqual(baseDelayMs + delta);
    }
  });

  it('never exceeds maxDelayMs, even at high attempts', () => {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const delay = computeDelay(attempt, DEFAULT_RETRY_POLICY);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.maxDelayMs);
    }
  });

  it('grows exponentially (baseDelayMs * 2^(attempt-1)) before the cap', () => {
    expect(computeDelay(1, NO_JITTER)).toBe(1_000);
    expect(computeDelay(2, NO_JITTER)).toBe(2_000);
    expect(computeDelay(3, NO_JITTER)).toBe(4_000);
  });
});

describe('shouldRetry', () => {
  it('never retries PERMANENT failures', () => {
    expect(shouldRetry(failure(FailureClass.PERMANENT), 1, DEFAULT_RETRY_POLICY)).toBe(false);
  });

  it('retries TRANSIENT up to 3 times, then stops', () => {
    expect(shouldRetry(failure(FailureClass.TRANSIENT), 3, DEFAULT_RETRY_POLICY)).toBe(true);
    expect(shouldRetry(failure(FailureClass.TRANSIENT), 4, DEFAULT_RETRY_POLICY)).toBe(false);
  });

  it('retries RESOURCE up to 2 times, then stops', () => {
    expect(shouldRetry(failure(FailureClass.RESOURCE), 2, DEFAULT_RETRY_POLICY)).toBe(true);
    expect(shouldRetry(failure(FailureClass.RESOURCE), 3, DEFAULT_RETRY_POLICY)).toBe(false);
  });
});
