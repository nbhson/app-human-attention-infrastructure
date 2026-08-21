/**
 * Attention Engine (day-18) — Phase-1 review-priority scoring.
 *
 * Public surface:
 * - `types`      — factor keys, weights, score + assessment shapes.
 * - `scoring`    — the corrected combined-priority formula and label mapping.
 * - `factors`    — the five pure factor extractors.
 * - `AttentionSubscriber` — scores every task landing in AWAITING_REVIEW and
 *   publishes `attention.assessment_created`.
 */

export * from './types.js';
export * from './scoring.js';
export * from './factors.js';
export { AttentionSubscriber } from './attention-subscriber.js';
