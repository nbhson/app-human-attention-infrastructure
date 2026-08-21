/**
 * `DispatchLoop` — the coroutine that polls the queue on a fixed interval
 * (day-08 §2.5). `setInterval` (never `setTimeout` recursion) plus an in-flight
 * guard keeps ticks from overlapping when a poll takes longer than the interval.
 *
 * Its only job is scheduling and logging: it drives {@link Dispatcher} and keeps
 * the loop alive when a single poll throws. The interval is caller-supplied so
 * the process reads `DISPATCH_INTERVAL_MS` once, rather than this class doing it.
 */

import type { Dispatcher } from './dispatcher.js';

/**
 * The two log levels the loop emits, shaped to the di {@link import('@harness/di').Logger}
 * signature (message-first) so the composition root can inject the real logger
 * directly (day-27 §2.1).
 */
export interface DispatchLoopLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const DEFAULT_INTERVAL_MS = 2000;

export class DispatchLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(
    private readonly dispatcher: Dispatcher,
    private readonly logger: DispatchLoopLogger,
  ) {}

  /** Whether the loop is currently armed. */
  get running(): boolean {
    return this.timer !== null;
  }

  /** Begin polling every `intervalMs`. A no-op if already running. */
  start(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.poll();
    }, intervalMs);
  }

  /** Stop polling. In-flight poll (if any) is allowed to finish. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Resolve once any in-flight poll drains. `stop()` only clears the timer; it
   * does not join the currently-running tick. The graceful-shutdown path awaits
   * this so a SIGTERM never aborts a dispatch mid-claim.
   */
  async waitForIdle(): Promise<void> {
    while (this.inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private async poll(): Promise<void> {
    if (this.inFlight) {
      return; // previous tick still running — skip rather than stack up.
    }
    this.inFlight = true;
    try {
      const result = await this.dispatcher.dispatchPending();
      this.logger.debug('dispatch tick', {
        polled: result.dispatched + result.skipped + result.failed,
        dispatched: result.dispatched,
        skipped: result.skipped,
        failed: result.failed,
      });
    } catch (error) {
      // A transient failure must not kill the loop (day-08 §3.3).
      this.logger.error('dispatch tick failed', { error: String(error) });
    } finally {
      this.inFlight = false;
    }
  }
}
