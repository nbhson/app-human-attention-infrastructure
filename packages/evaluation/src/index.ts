/**
 * `@harness/evaluation` — offline pipeline-quality metrics (day-06).
 *
 * Scores the pipeline, not the change. `MetricsComputer` is a pure function over
 * windowed store rows; `loadMetricsInput` reads those rows; `applyGauges` pushes
 * the results onto the Day-04 Prometheus gauges. `cli.ts` is the `pnpm eval:metrics`
 * entrypoint.
 */

export * from './report.js';
export { MetricsComputer, applyGauges } from './metrics-computer.js';
export * from './labels.js';
export { loadMetricsInput } from './loader.js';
export type { MetricsWindow } from './loader.js';
