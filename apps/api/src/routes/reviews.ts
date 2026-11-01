/**
 * Review-slice HTTP routes (review-reorient Phase 3) — the thin Fastify surface
 * over {@link ReviewIngestService} and the `review_reports` projection.
 *
 * The slice was previously a single 886-line file; it is now grouped by
 * endpoint family into sibling modules in `routes/` (pure refactor — response
 * shapes, status codes, rate-limit wiring, and the `dedup_key` idempotency are
 * unchanged):
 *
 *  - `reviews-ingest.ts`   `POST /api/reviews`             paste a PR URL (+ optional Jira ticket) → 202, async AI review
 *  - `reviews-list.ts`     `GET  /api/reviews` + `/summary` list rows with triage/risk summary + aggregate counts
 *  - `reviews-detail.ts`   `GET  /api/reviews/:id`         report + findings + suggestions + stats + trace + verification
 *  - `reviews-auto.ts`     `POST /api/reviews/auto`         sync full-severity review when `auto_review_enabled` is ON
 *  - `reviews-decision.ts` `POST /api/reviews/:id/decision` idempotent human decision (`dedup_key`) + write-back saga
 *  - `reviews-retry.ts`    `POST /api/reviews/:id/retry`    transactional reset of a failed report + re-publish
 *
 * All of them are guarded with {@link requireRole}: ingesting and reading a
 * report require any authenticated principal (`Operate`), while the human
 * decision (which can trigger a PR write-back) requires `Reviewer`/`Admin`.
 */

import type { FastifyInstance } from 'fastify';
import type { Container } from '@harness/di';

import { registerReviewIngestRoute } from './reviews-ingest.js';
import { registerReviewListRoutes } from './reviews-list.js';
import { registerReviewDetailRoute } from './reviews-detail.js';
import { registerReviewAutoRoute } from './reviews-auto.js';
import { registerReviewDecisionRoute, decisionDedupKey } from './reviews-decision.js';
import { registerReviewRetryRoute } from './reviews-retry.js';

export { decisionDedupKey };

/** Register the review endpoints under `/api/reviews` (single app.ts entry). */
export function registerReviewIngestRoutes(
  app: FastifyInstance,
  container: Container,
  rateLimit?: (ip: string) => boolean,
): void {
  // Registration order mirrors the pre-split file; Fastify's router resolves
  // static paths (`/summary`) ahead of the `:id` param either way.
  registerReviewIngestRoute(app, container, rateLimit);
  registerReviewListRoutes(app, container);
  registerReviewDetailRoute(app, container);
  registerReviewAutoRoute(app, container, rateLimit);
  registerReviewDecisionRoute(app, container);
  registerReviewRetryRoute(app, container);
}
