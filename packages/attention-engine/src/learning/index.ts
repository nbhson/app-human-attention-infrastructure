/**
 * Learning loop (day-31) — Evaluate → Calibrate → (measured) Deploy.
 *
 * Public surface:
 * - `types`          — facts, samples, candidate, run-provenance, seams.
 * - `collector`      — pure windowing + sample derivation.
 * - `promotion-gate` — the measured PROMOTE/HOLD guardrail.
 * - `calibration-job`— the loop orchestration (`CalibrationJob.run`).
 */

export * from './types.js';
export * from './collector.js';
export * from './promotion-gate.js';
export * from './calibration-job.js';
