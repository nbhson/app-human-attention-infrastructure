/**
 * Review backend (day-22) — the human-review queue + decision API.
 *
 * Public surface:
 * - `types`         — decision/drop/release/escalate inputs, read models, seam + error types.
 * - `state-machine` — Spec 8 §2.2 legal-transition graph (day-24).
 * - `service`       — `ReviewService` (list/detail reads; claim/decide/release/escalate/drop).
 */

export * from './types.js';
export * from './state-machine.js';
export * from './service.js';
