/**
 * Background worker for async review processing (Phase 4).
 *
 * Subscribes to `review.requested` events and calls
 * {@link ReviewIngestService.processReview} to run the AI review pipeline
 * without blocking the HTTP response.
 *
 * Retries transient failures with exponential back-off (up to 3 attempts) so
 * a brief AI-provider hiccup or GitHub rate-limit does not silently lose the
 * review. Permanent errors (bad PR URL, missing provider) are logged and
 * surfaced via the report's `review_status` after the last attempt.
 */

import type { ReviewRequestedPayload } from '@harness/domain';
import { EventType } from '@harness/domain';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';

import type { ReviewIngestService } from './review-ingest.js';

/** Max retry attempts before giving up and marking the report as failed. */
const MAX_RETRIES = 3;
/** Base delay in ms; doubled per attempt (1s, 2s, 4s). */
const RETRY_BASE_MS = 1_000;

/**
 * Upstream status codes worth retrying: rate limiting and server-side faults.
 * Anything else with an explicit status (4xx validation, 404 missing PR) is a
 * permanent fault — retrying would burn LLM quota without ever succeeding.
 */
const TRANSIENT_STATUS_CODES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/** Message fingerprints of transient network/timeout faults (no status attached). */
const TRANSIENT_MESSAGE_PATTERN =
  /429|502|503|504|rate.?limit|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i;

/**
 * P0 fix (rewritten): classify a pipeline failure as transient (retryable) or
 * permanent. The previous nested-ternary predicate never retried HTTP 500 and
 * its `|| status !== undefined` tail made the message regex dead code.
 *
 * An explicit status decides on its own; only status-less errors (network
 * faults, timeouts) fall back to matching the message text.
 */
export function isTransientReviewError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }
  const status = (error as { status?: number }).status;
  if (typeof status === 'number') {
    return TRANSIENT_STATUS_CODES.has(status);
  }
  const msg = error instanceof Error ? error.message : String(error);
  return TRANSIENT_MESSAGE_PATTERN.test(msg);
}

export class ReviewWorkerSubscriber {
  constructor(
    private readonly ingest: ReviewIngestService,
    private readonly bus: IEventBus,
    private readonly logger: Logger,
  ) {}

  /** Subscribe to `review.requested` events. */
  subscribe(): void {
    this.bus.subscribe(EventType.ReviewRequested, (event) => {
      const payload = event.payload as ReviewRequestedPayload;
      void this.processWithRetry(payload).catch((error) => {
        this.logger.error('review worker failed after retries', {
          report_id: payload.review_report_id,
          error: String(error),
        });
      });
    });
    this.logger.info('review worker subscribed to review.requested');
  }

  private async processWithRetry(payload: ReviewRequestedPayload): Promise<void> {
    const args: Parameters<typeof this.ingest.processReview>[1] = {
      prUrl: payload.pr_url,
      ...(payload.jira_ticket !== undefined ? { jiraTicket: payload.jira_ticket } : {}),
      ...(payload.autoReviewMode !== undefined ? { autoReviewMode: payload.autoReviewMode } : {}),
    };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.info('review worker processing', {
          report_id: payload.review_report_id,
          pr_url: payload.pr_url,
          attempt,
        });
        await this.ingest.processReview(payload.review_report_id, args);
        return; // success — stop retrying (processReview persists error status itself)
      } catch (error) {
        // P0 fix: only retry transient faults (429/5xx/timeout/network). Permanent
        // ReviewIngestError 4xx (bad URL, validation) must not burn LLM quota.
        // processReview already persists `review_status=error`, so a permanent
        // failure returns here without further retries.
        const msg = error instanceof Error ? error.message : String(error);
        const transient = isTransientReviewError(error);
        if (!transient || attempt === MAX_RETRIES) {
          if (!transient) {
            this.logger.warn('review worker permanent failure — not retrying', {
              report_id: payload.review_report_id,
              error: msg,
            });
          } else {
            this.logger.error('review worker exhausted retries', {
              report_id: payload.review_report_id,
              pr_url: payload.pr_url,
              attempt,
              error: msg,
            });
          }
          throw error;
        }
        const delayMs = RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
        this.logger.warn('review worker retrying', {
          report_id: payload.review_report_id,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          error: msg,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}
