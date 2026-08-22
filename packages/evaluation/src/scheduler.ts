/**
 * In-process cron edge for scheduled reports (day-07 §2.4, §3.3).
 *
 * The modular monolith still runs on one process, so the scheduled edge is a
 * `node-cron` job, not a sidecar. A missed tick is logged, not a lost fact —
 * reports can always be backfilled via `pnpm eval:report --from/--to`. The
 * scheduler is best-effort by design; do not add a durable queue here (day-07 §6).
 *
 * The cron dependency is injected through {@link CronLike} so tests can assert
 * the expression and tick wiring without starting a real cron thread (day-07 §5).
 */

import cron from 'node-cron';

/** The minimal surface of `node-cron` the scheduler needs (test seam). */
export interface CronLike {
  schedule(expression: string, task: () => void): { stop: () => void };
}

/** The real `node-cron` adapter. */
export const nodeCron: CronLike = {
  schedule(expression, task) {
    return cron.schedule(expression, task);
  },
};

export type ReportTick = () => void | Promise<void>;

/**
 * Wraps a periodic report tick behind `start`/`stop`. Construction is inert —
 * nothing runs until {@link start}, so importing this module in a test (or the
 * report CLI's `--once` path) never spins up a background thread.
 */
export class ReportScheduler {
  private handle: { stop: () => void } | undefined;

  constructor(
    private readonly cronAdapter: CronLike,
    private readonly expression: string,
    private readonly tick: ReportTick,
  ) {}

  start(): void {
    this.handle = this.cronAdapter.schedule(this.expression, () => {
      void this.tick();
    });
  }

  stop(): void {
    this.handle?.stop();
    this.handle = undefined;
  }
}

/** A no-op stand-in used by tests and the non-scheduled code paths. */
export const NOOP_CRON: CronLike = {
  schedule() {
    return { stop: () => {} };
  },
};
