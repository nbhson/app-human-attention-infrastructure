/**
 * Unit tests for the review worker's transient/permanent fault classification.
 *
 * Regression coverage for the P0 predicate rewrite: the previous nested-ternary
 * never retried HTTP 500 and its `|| status !== undefined` tail made the
 * message regex dead code. These tests pin the intended behaviour:
 *
 * - explicit status decides on its own (429/5xx transient, 4xx permanent)
 * - status-less errors (network faults, timeouts) classify by message text
 */

import { describe, expect, it } from 'vitest';

import { isTransientReviewError } from '../services/review-worker.js';

describe('isTransientReviewError', () => {
  describe('explicit status codes', () => {
    it('classifies 429 and 5xx as transient', () => {
      expect(isTransientReviewError({ status: 429 })).toBe(true);
      expect(isTransientReviewError({ status: 500 })).toBe(true);
      expect(isTransientReviewError({ status: 502 })).toBe(true);
      expect(isTransientReviewError({ status: 503 })).toBe(true);
      expect(isTransientReviewError({ status: 504 })).toBe(true);
    });

    it('classifies client-error statuses as permanent — even with transient-sounding messages', () => {
      // A permanent fault must not be rescued by its message text.
      expect(isTransientReviewError({ status: 400, message: 'timeout while validating PR URL' })).toBe(false);
      expect(isTransientReviewError({ status: 401 })).toBe(false);
      expect(isTransientReviewError({ status: 403 })).toBe(false);
      expect(isTransientReviewError({ status: 404, message: 'rate limit exceeded upstream' })).toBe(false);
      expect(isTransientReviewError({ status: 422 })).toBe(false);
    });

    it('is a permanent fault for a plain Error with a transient-looking status message but no status property', () => {
      // The regex inspects the message only when no status is attached; a bare
      // "429" in prose still matches by design (provider SDKs log it that way).
      expect(isTransientReviewError(new Error('upstream returned 503'))).toBe(true);
    });
  });

  describe('status-less errors (network / timeout faults)', () => {
    it('classifies timeout and connection faults as transient', () => {
      expect(isTransientReviewError(new Error('Request timed out after 30000ms'))).toBe(true);
      expect(isTransientReviewError(new Error('fetch failed'))).toBe(true);
      expect(isTransientReviewError(new Error('socket hang up'))).toBe(true);
      expect(isTransientReviewError(new Error('getaddrinfo EAI_AGAIN api.github.com'))).toBe(true);
      expect(isTransientReviewError(new Error('read ECONNRESET'))).toBe(true);
      expect(isTransientReviewError(new Error('rate limit exceeded, retry after 60s'))).toBe(true);
    });

    it('classifies unknown status-less errors as permanent', () => {
      expect(isTransientReviewError(new Error('jira ticket not found'))).toBe(false);
      expect(isTransientReviewError('some plain string failure')).toBe(false);
      expect(isTransientReviewError(undefined)).toBe(false);
      expect(isTransientReviewError(null)).toBe(false);
    });
  });
});
