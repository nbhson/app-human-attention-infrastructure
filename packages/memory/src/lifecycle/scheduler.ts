/**
 * The memory lifecycle job (review-reorient Phase 3, day-19 §2.1 §3.4).
 *
 * `MemoryLifecycle.tick()` is the single idempotent entry point that runs the
 * three life stages in dependency order — consolidate (§2.2) → decay (§2.3) →
 * archive (§2.4) — and returns their aggregate results. The scheduler wraps the
 * tick on a timer so a server entrypoint can drive it on a cadence; the tick
 * itself stays a plain async method so tests (and off-band CLIs) can call it
 * directly and assert on the results, never on wall-clock timing.
 */

import type { DrizzleDB } from '@harness/db';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';

import { archiveBelowThreshold } from './archive.js';
import type { ArchiveResult } from './archive.js';
import { consolidateChains } from './consolidate.js';
import type { ConsolidateResult } from './consolidate.js';
import { applyDecay } from './decay.js';
import type { DecayResult } from './decay.js';

/** Default tick interval when a scheduler is started without an override. */
export const DEFAULT_LIFECYCLE_INTERVAL_MS = 60 * 60 * 1000; // hourly

/** Tuning knobs for one lifecycle tick. */
export interface LifecycleOptions {
  readonly now?: Date;
  readonly factorPerDay?: number;
  readonly graceDays?: number;
  readonly archiveThreshold?: number;
}

/** Aggregate result of one lifecycle tick (consolidate → decay → archive). */
export interface LifecycleTickResult {
  readonly consolidated: ConsolidateResult;
  readonly decayed: DecayResult;
  readonly archived: ArchiveResult;
}

/** The idempotent memory-lifecycle tick: fold chains, fade stale memory, archive. */
export class MemoryLifecycle {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly logger?: Logger,
  ) {}

  /** Run all three life stages in dependency order and return their summaries. */
  async tick(options: LifecycleOptions = {}): Promise<LifecycleTickResult> {
    // Consolidate first so charted-but-superseded rows are gone before decay;
    // archive last so a decayed-to-floor row can drop in the same tick.
    const consolidated = await consolidateChains(this.db, this.bus, this.logger);
    const decayed = await applyDecay(this.db, {
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.factorPerDay !== undefined ? { factorPerDay: options.factorPerDay } : {}),
      ...(options.graceDays !== undefined ? { graceDays: options.graceDays } : {}),
    });
    const archived = await archiveBelowThreshold(
      this.db,
      this.bus,
      options.archiveThreshold !== undefined ? { threshold: options.archiveThreshold } : {},
      this.logger,
    );

    return { consolidated, decayed, archived };
  }
}

/**
 * Drives {@link MemoryLifecycle.tick} on an interval. `start()`/`stop()` are
 * explicit (and idempotent) so a server entrypoint owns the timer; the tick's
 * errors are logged, never thrown unhandled into the event loop.
 */
export class MemoryLifecycleScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly lifecycle: MemoryLifecycle,
    private readonly intervalMs: number = DEFAULT_LIFECYCLE_INTERVAL_MS,
    private readonly logger?: Logger,
  ) {}

  /** Begin ticking on the interval. No-op if already running. */
  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.lifecycle.tick().catch((error: unknown) => {
        this.logger?.error('memory: lifecycle tick failed', { error: String(error) });
      });
    }, this.intervalMs);
  }

  /** Stop ticking. No-op if not running. */
  stop(): void {
    if (this.timer === null) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }
}
