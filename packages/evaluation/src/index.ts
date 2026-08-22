/**
 * `@harness/evaluation` — offline pipeline-quality metrics (day-06) & replay (day-08).
 *
 * Scores the pipeline, not the change. `MetricsComputer` is a pure function over
 * windowed store rows; `loadMetricsInput` reads those rows; `applyGauges` pushes
 * the results onto the Day-04 Prometheus gauges. `TrajectoryReplayer` faithfully
 * re-materialises a recorded run offline for the Day-09 A/B shadow harness.
 * `cli.ts`/`report-cli.ts`/`replay-cli.ts` are the `pnpm eval:*` entrypoints.
 */

export * from './report.js';
export { MetricsComputer, applyGauges } from './metrics-computer.js';
export * from './labels.js';
export { loadMetricsInput } from './loader.js';
export type { MetricsWindow } from './loader.js';
export { ReportGenerator, EmptyWindowError } from './report-generator.js';
export { ReportStore } from './report-store.js';
export type { StoredReport } from './report-store.js';
export { ReportScheduler, nodeCron, NOOP_CRON } from './scheduler.js';
export type { CronLike, ReportTick } from './scheduler.js';
export { TrajectoryReplayer } from './trajectory-replayer.js';
export type { ReplayInput, ReplayStep, ReplayResult } from './trajectory-replayer.js';
export { ReplayDivergenceError, TrajectoryHashMismatchError } from './replay/errors.js';
export { hashSteps, stableStringify } from './replay/hash.js';
export { loadTrajectory } from './replay/loader.js';
export type { LoadedTrajectory } from './replay/loader.js';
export { StubToolExecutor } from './replay/stub-tool-executor.js';
export type { ToolExecutor } from './replay/stub-tool-executor.js';
