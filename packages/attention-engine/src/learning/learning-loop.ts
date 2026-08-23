/**
 * Learning loop (day-33 §3.1) — the closed cycle as a tracked state machine.
 *
 * Day-31's {@link CalibrationJob} reduced Evaluate→Calibrate→(measured)Deploy to one
 * `run()`. Day-33 wraps it in a four-stage cycle state machine that closes the loop:
 *
 * ```
 * evaluate → calibrate → deploy → observe
 *   collect     fit       gate      feed-forward
 * ```
 *
 * Each stage is stamped by a {@link CycleAudit} under one cycle correlation id; the
 * audit publishes `learning.stage_completed` per stage and `learning.loop_completed`
 * once. The **Observe stage is the feed-forward** (day-33 §2.3): the cursor
 * `collectedAt` becomes the next cycle's `since`, so `runCycle()` re-enters Evaluate
 * with the next window automatically — no manual kick. HOLD is not a dead end
 * (day-33 §2.1): a held candidate parks at Deploy and the cycle still completes with
 * outcome `held`, and the loop returns to Evaluate with the advanced cursor.
 *
 * The loop **tunes calibration/routing only**; the human APPROVE/REJECT gate and the
 * sampled AUTO_APPROVABLE path are untouched (day-33 §2.4). Like `CalibrationJob`,
 * it never applies a weight vector itself — `promoted` is an audit flag; adopting a
 * promoted candidate is a separate, explicit caller step.
 */

import { newCorrelationID } from '@harness/domain';
import type { CorrelationID, LearningOutcome } from '@harness/domain';
import type { IEventBus } from '@harness/event-bus';

import { CalibrationJob } from './calibration-job.js';
import { CycleAudit } from './cycle-audit.js';
import type { LearningCycleRecord } from './cycle-audit.js';
import type { LearningRun } from './types.js';

/** A cycle-id seam (deterministic under test). */
type NewCycleId = () => CorrelationID;
/** A wall-clock seam. */
type Clock = () => Date;

/**
 * The closed learning loop. Composes a {@link CalibrationJob} (the real
 * evaluate→calibrate→deploy compute) with a correlation-id audit, an optional bus
 * (absent in tests), and a feed-forward cursor it carries between cycles.
 */
export class LearningLoop {
  /** The cursor the next cycle feeds into Evaluate (Observe→Evaluate feed-forward). */
  private nextSince: Date | null = null;

  constructor(
    private readonly job: CalibrationJob,
    private readonly bus: IEventBus | undefined = undefined,
    private readonly newCycleId: NewCycleId = newCorrelationID,
    private readonly now: Clock = () => new Date(),
  ) {}

  /** The current Observe→Evaluate cursor (`null` before the first cycle). */
  get cursor(): Date | null {
    return this.nextSince;
  }

  /**
   * Run one full cycle. `since` defaults to the fed-forward cursor, so consecutive
   * `runCycle()` calls re-enter Evaluate with the next window automatically.
   */
  async runCycle(since: Date | null = this.nextSince): Promise<LearningCycleRecord> {
    const audit = new CycleAudit(this.newCycleId(), this.bus, this.now);

    let run: LearningRun;
    try {
      run = await this.job.run(since);
    } catch (error) {
      audit.record('evaluate', 'failed', error instanceof Error ? error.message : String(error));
      return audit.finalize('failed', {
        candidateProposed: false,
        promoted: false,
        sampleCount: 0,
        nextSince: null,
      });
    }

    const sampleCount = run.window.reviewIds.length;
    const candidateProposed = run.candidate !== null;
    const promoted = run.promoted;

    audit.record('evaluate', 'succeeded', `${sampleCount} fresh facts`);

    if (candidateProposed) {
      audit.record('calibrate', 'succeeded', 'candidate fitted');
      if (promoted) {
        audit.record('deploy', 'succeeded', 'PROMOTE — measured WIN');
      } else {
        audit.record('deploy', 'held', 'HOLD — guardrail (no measured WIN, or judge dominates)');
      }
    } else {
      audit.record('calibrate', 'succeeded', 'empty window — no candidate fit');
      audit.record('deploy', 'succeeded', 'nothing to deploy');
    }

    // Observe: feed the next Evaluate window with this cycle's collection cursor.
    this.nextSince = run.window.collectedAt;
    audit.record('observe', 'succeeded', `next window since → ${this.nextSince.toISOString()}`);

    const outcome: LearningOutcome = candidateProposed && !promoted ? 'held' : 'completed';
    return audit.finalize(outcome, {
      candidateProposed,
      promoted,
      sampleCount,
      nextSince: this.nextSince,
    });
  }
}
