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
    };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.info('review worker processing', {
          report_id: payload.review_report_id,
          pr_url: payload.pr_url,
          attempt,
        });
        await this.ingest.processReview(payload.review_report_id, args);
        return; // success — stop retrying
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          this.logger.error('review worker exhausted retries', {
            report_id: payload.review_report_id,
            pr_url: payload.pr_url,
            attempt,
            error: String(error),
          });
          throw error;
        }
        const delayMs = RETRY_BASE_MS * 2 ** (attempt - 1);
        this.logger.warn('review worker retrying', {
          report_id: payload.review_report_id,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          error: String(error),
        });
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}
