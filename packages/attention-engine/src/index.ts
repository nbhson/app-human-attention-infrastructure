/**
 * Attention Engine (day-18/19) — Phase-1 review-priority scoring, policy & routing.
 *
 * Public surface:
 * - `types`      — factor keys, weights, score + assessment shapes.
 * - `scoring`    — the corrected combined-priority formula and label mapping.
 * - `factors`    — the five pure factor extractors.
 * - `policy`     — versioned rules mapping assessments → routing decisions.
 * - `router`     — enqueues assessments into `review_queue` + §4.1 fatigue.
 * - `AttentionSubscriber` — scores every task landing in AWAITING_REVIEW and
 *   publishes `attention.assessment_created`.
 */

export * from './types.js';
export * from './scoring.js';
export * from './factors.js';
export * from './policy.js';
export * from './router.js';
export * from './weights/weights-provider.js';
export * from './thresholds/threshold-store.js';
export * from './thresholds/adaptive-threshold.js';
export * from './thresholds/daily-budget.js';
export * from './thresholds/inflation-monitor.js';
export * from './auto-approve/gate.js';
export * from './auto-approve/kill-switch.js';
export * from './auto-approve/sampler.js';
export * from './auto-approve/executor.js';
export { AttentionSubscriber } from './attention-subscriber.js';
