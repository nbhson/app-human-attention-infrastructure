/**
 * Background worker for async review processing (Phase 4).
 *
 * Subscribes to `review.requested` events and calls
 * {@link ReviewIngestService.processReview} to run the AI review pipeline
 * without blocking the HTTP response.
 *
 * The subscriber runs fire-and-forget: it catches and logs errors so a
 * single failed review never crashes the process or stalls the queue.
 */

import type { ReviewRequestedPayload } from '@harness/domain';
import { EventType } from '@harness/domain';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';

import type { ReviewIngestService } from './review-ingest.js';

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
      this.process(payload).catch((error) => {
        this.logger.error('review worker failed', {
          report_id: payload.review_report_id,
          error: String(error),
        });
      });
    });
    this.logger.info('review worker subscribed to review.requested');
  }

  private async process(payload: ReviewRequestedPayload): Promise<void> {
    this.logger.info('review worker processing', {
      report_id: payload.review_report_id,
      pr_url: payload.pr_url,
    });

    await this.ingest.processReview(payload.review_report_id, {
      prUrl: payload.pr_url,
      ...(payload.jira_ticket !== undefined ? { jiraTicket: payload.jira_ticket } : {}),
    } as Parameters<typeof this.ingest.processReview>[1]);
  }
}
