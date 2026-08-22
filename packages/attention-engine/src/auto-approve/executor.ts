/**
 * Auto-approve executor (day-14 §2.3, §3.3) — acts on the `AUTO_APPROVABLE` path.
 *
 * When a change's routing decision is `AUTO_APPROVABLE`, the executor:
 *
 *  1. re-checks the kill-switch (refuse if tripped),
 *  2. evaluates the three-part gate (calibration green + flag on + clears bar),
 *  3. on denial, logs a governance denial and refuses — never a silent fail,
 *  4. on approval, writes an `AUTO_APPROVED` decision (actor `NULL` — no human
 *     acted), flips the queue row `QUEUED → DECIDED`, and drives the task
 *     `AWAITING_REVIEW → APPROVED` (`triggered_by: 'auto_approve'`). MergeService
 *     (day-24) then owns `APPROVED → COMPLETED`, exactly as for a human approval.
 *
 * The cross-engine dependencies — reading the latest calibration fit + inflation
 * gauge, and driving the task state machine — are narrow structural seams
 * ({@link AutoApproveLoader}, {@link AutoApproveTaskTransition}) injected by the
 * composition root, so attention-engine never imports orchestrator or evaluation.
 */

import { and, desc, eq } from 'drizzle-orm';

import { assessments, calibrationWeights, decisions, reviewQueue } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import {
  brand,
  EventType,
  HumanDecisionType,
  newDecisionID,
  ReviewQueueStatus,
  TaskStatus,
} from '@harness/domain';
import type {
  AttentionItemRoutedPayload,
  DecisionID,
  ReviewQueueItemID,
  TaskID,
  TaskStatus as TaskState,
  TaskTrigger,
} from '@harness/domain';
import type { IEventBus } from '@harness/event-bus';
import { gauges } from '@harness/observability';
import type { Logger } from '@harness/di';

import { AutoApproveGate } from './gate.js';
import type { AutoApproveGateResult, CalibrationEvidence } from './gate.js';
import { AutoApproveKillSwitch } from './kill-switch.js';
import { AutoApproveSampler } from './sampler.js';
import { INFLATION_GAUGE } from '../thresholds/inflation-monitor.js';
import type { AttentionPolicy } from '../policy.js';

/** The latest calibration fit + inflation share the gate needs (injected seam). */
export interface AutoApproveLoader {
  loadCalibrationEvidence(): Promise<CalibrationEvidence | null>;
  loadInflationShare(): Promise<number>;
}

/** DB-backed loader: latest `calibration_weights` row + the inflation gauge. */
export class DbAutoApproveLoader implements AutoApproveLoader {
  constructor(private readonly db: DrizzleDB) {}

  async loadCalibrationEvidence(): Promise<CalibrationEvidence | null> {
    const rows = await this.db
      .select({
        datasetId: calibrationWeights.dataset_id,
        logLossFitted: calibrationWeights.log_loss_fitted,
        logLossPlaceholder: calibrationWeights.log_loss_placeholder,
        rankingAccuracyFitted: calibrationWeights.ranking_accuracy_fitted,
        rankingAccuracyPlaceholder: calibrationWeights.ranking_accuracy_placeholder,
      })
      .from(calibrationWeights)
      .orderBy(desc(calibrationWeights.created_at))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return row;
  }

  async loadInflationShare(): Promise<number> {
    const gauge = gauges.get(INFLATION_GAUGE);
    if (!gauge) {
      return 0;
    }
    const data = await gauge.get();
    const value = data.values[0]?.value;
    return typeof value === 'number' ? value : 0;
  }
}

/** Structural seam onto the task state machine (injected; mirrors review's R6). */
export interface AutoApproveTaskTransition {
  transitionTask(
    taskId: TaskID,
    toState: TaskState,
    triggeredBy: TaskTrigger,
    opts?: { readonly rationale?: string; readonly expectedFrom?: TaskState },
  ): Promise<unknown>;
}

/** Dependencies the executor needs, wired once at the composition root. */
export interface AutoApproveExecutorDeps {
  readonly db: DrizzleDB;
  readonly bus: IEventBus;
  readonly gate: AutoApproveGate;
  readonly killSwitch: AutoApproveKillSwitch;
  readonly sampler: AutoApproveSampler;
  readonly taskTransition: AutoApproveTaskTransition;
  readonly policy: AttentionPolicy;
  readonly loader: AutoApproveLoader;
  readonly logger?: Logger;
}

/** The result of one `execute` call, structured so denials carry their reason. */
export type AutoApproveOutcome =
  | { readonly approved: true; readonly decisionId: DecisionID; readonly sampled: boolean }
  | { readonly approved: false; readonly reason: string };

/** The queue+assessment row the executor reloads before acting. */
interface AutoApproveRow {
  readonly task_id: string;
  readonly assessment_id: string;
  readonly change_id: string;
  readonly action: string;
  readonly status: string;
  readonly combined_priority: number;
}

export class AutoApproveExecutor {
  constructor(private readonly deps: AutoApproveExecutorDeps) {}

  /**
   * The trigger: on `attention.item_routed` with `action = AUTO_APPROVABLE`, run
   * the path. Denials ride the `execute` return value (no event is published for
   * a failed auto-approve — it stays `QUEUED` and unreviewed until an operator
   * acts, but the governance denial is logged, never silent).
   */
  subscribe(): void {
    this.deps.bus.subscribe<AttentionItemRoutedPayload>(EventType.AttentionItemRouted, (event) => {
      if (event.payload.action !== 'AUTO_APPROVABLE') {
        return;
      }
      void this.execute(event.payload.queue_id).catch((error) => {
        this.deps.logger?.error('auto-approve execution failed', {
          queue_id: event.payload.queue_id,
          error: String(error),
        });
      });
    });
  }

  async execute(queueId: ReviewQueueItemID): Promise<AutoApproveOutcome> {
    const row = await this.reload(queueId);
    if (!row) {
      return { approved: false, reason: 'not-found' };
    }

    // An `ALWAYS_REVIEW` path (any non-AUTO_APPROVABLE action) can never be
    // auto-approved — this is the executor-level re-assertion of gate part 3.
    if (row.action !== 'AUTO_APPROVABLE') {
      return { approved: false, reason: 'always-review' };
    }
    if (row.status !== ReviewQueueStatus.Queued) {
      return { approved: false, reason: 'not-queued' };
    }

    // Kill-switch: checked on every decision, before anything else (§2.2).
    const switchState = await this.deps.killSwitch.read();
    if (switchState.killed) {
      return { approved: false, reason: 'kill-switch-tripped' };
    }

    const [calibration, inflationShare] = await Promise.all([
      this.deps.loader.loadCalibrationEvidence(),
      this.deps.loader.loadInflationShare(),
    ]);

    const gateResult: AutoApproveGateResult = this.deps.gate.evaluate({
      calibration,
      inflationShare,
      flagEnabled: switchState.flagEnabled,
      combinedPriority: row.combined_priority,
      alwaysReview: false,
    });
    if (!gateResult.allowed) {
      // A governance denial — not an approval, and not silent (§2.1, §6).
      this.deps.logger?.warn('auto-approve: governance denial', {
        queue_id: queueId,
        change_id: row.change_id,
        reason: gateResult.reason,
      });
      return { approved: false, reason: gateResult.reason };
    }

    // Sampling audit: a fraction of approvals are also routed to a silent human
    // control (§2.3). Decided here, recorded on the decision row below.
    const sampled = this.deps.sampler.shouldSample(this.deps.policy.autoApprove.auditSampleRate);
    const datasetId = calibration?.datasetId ?? null;
    const rationale = `Auto-approved: priority ${row.combined_priority} < ${
      this.deps.policy.autoApprove.maxRisk
    }, calibration green (dataset ${datasetId ?? 'n/a'})`;

    // Guarded queue flip QUEUED → DECIDED (a concurrent human claim loses).
    const flipped = await this.deps.db
      .update(reviewQueue)
      .set({ status: ReviewQueueStatus.Decided })
      .where(and(eq(reviewQueue.id, queueId), eq(reviewQueue.status, ReviewQueueStatus.Queued)))
      .returning({ id: reviewQueue.id });
    if (flipped.length === 0) {
      return { approved: false, reason: 'queue-state-changed' };
    }

    // §2.4 record: the audit trail is unbroken even with no human — a distinct
    // decision value and `actor_id IS NULL` mark the machine decision.
    const decisionId = newDecisionID();
    const changeId = brand(row.change_id, 'ChangeID');
    const assessmentId = brand(row.assessment_id, 'AssessmentID');
    await this.deps.db.insert(decisions).values({
      id: decisionId,
      correlation_id: row.task_id,
      change_id: changeId,
      assessment_id: assessmentId,
      decision: HumanDecisionType.AutoApproved,
      reviewer_id: 'auto-approve',
      actor_id: null,
      actor_email: null,
      sample: sampled,
      dataset_id: datasetId,
      rationale,
    });

    // Drive AWAITING_REVIEW → APPROVED under a machine trigger. The dance stops
    // here: MergeService closes APPROVED → COMPLETED, as it does for humans.
    await this.deps.taskTransition.transitionTask(
      brand(row.task_id, 'TaskID'),
      TaskStatus.Approved,
      'auto_approve',
      { rationale, expectedFrom: TaskStatus.AwaitingReview },
    );

    if (sampled) {
      await this.deps.sampler.routeToHuman({
        taskId: brand(row.task_id, 'TaskID'),
        assessmentId: assessmentId,
        changeId: changeId,
        policyVersion: this.deps.policy.version,
      });
    }

    return { approved: true, decisionId, sampled };
  }

  private async reload(queueId: ReviewQueueItemID): Promise<AutoApproveRow | null> {
    const rows = await this.deps.db
      .select({
        task_id: reviewQueue.task_id,
        assessment_id: reviewQueue.assessment_id,
        change_id: assessments.change_id,
        action: reviewQueue.action,
        status: reviewQueue.status,
        combined_priority: assessments.combined_priority,
      })
      .from(reviewQueue)
      .innerJoin(assessments, eq(assessments.id, reviewQueue.assessment_id))
      .where(eq(reviewQueue.id, queueId))
      .limit(1);
    return rows[0] ?? null;
  }
}
