/**
 * `AttentionRouter` (day-19 §2.3) — turns an assessment into a routing decision
 * and enqueues it into `review_queue`.
 *
 * The router subscribes to `attention.assessment_created`; on receipt it re-loads
 * the assessment plus the signals the policy needs (task id, flaky verdict),
 * matches a policy rule, applies the §4.1 daily-budget gate (Day 13), and inserts
 * an **append-only, explainable** queue row (rule id + policy version + action).
 *
 * §4.1 alert-fatigue is now host-side discipline via the Day-13 controllers:
 *  - a {@link DailyBudgetGate} defers low-severity items (never drops them) and
 *    stamps `deferred_until` on the row + emits `attention.item_deferred`;
 *  - the {@link AdaptiveThresholdController} nudges the HIGH band from observed
 *    approval/rejection rates (see `thresholds/adaptive-threshold.ts`);
 *  - the {@link InflationMonitor} detects the engine systematically over-prioritising.
 * The budget count is **UTC** day-boundary (day-19 §6).
 */

import { desc, eq } from 'drizzle-orm';

import {
  agentRuns,
  assessmentFeedback,
  assessments,
  changes,
  reviewQueue,
  verificationReports,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import {
  brand,
  EventType,
  newAssessmentFeedbackID,
  newReviewQueueItemID,
  ReviewQueueStatus,
} from '@harness/domain';
import type {
  AssessmentCreatedPayload,
  AssessmentID,
  ReviewQueueItemID,
  RoutingAction,
  TaskID,
} from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { recordRouted } from '@harness/observability';
import type { Logger } from '@harness/di';

import { ATTENTION_POLICY_V1, matchRule } from './policy.js';
import type { AttentionPolicy, RoutingInput } from './policy.js';
import type { FactorKey, PriorityLabel } from './types.js';
import { DailyBudgetGate } from './thresholds/daily-budget.js';

/** The result of routing one assessment. */
export interface RoutingOutcome {
  readonly queueId: ReviewQueueItemID;
  readonly action: RoutingAction;
  readonly ruleId: string;
  /** True when the budget deferred this item (still QUEUED, flagged). */
  readonly deferred: boolean;
}

/** The row the router re-loads before matching policy. */
interface AssessmentRow {
  readonly id: string;
  readonly change_id: string;
  readonly label: string;
  readonly combined_priority: number;
  /** `jsonb` column — typed `unknown` by drizzle; cast in {@link toRoutingInput}. */
  readonly factors_unavailable: unknown;
}

export class AttentionRouter {
  private readonly budgetGate: DailyBudgetGate;

  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly policy: AttentionPolicy = ATTENTION_POLICY_V1,
    private readonly logger?: Logger,
    budgetGate?: DailyBudgetGate,
  ) {
    // The Day-13 budget gate reads `policy.fatigue.dailyReviewBudget`; a caller
    // may inject one (e.g. to pin `now` in tests).
    this.budgetGate =
      budgetGate ??
      new DailyBudgetGate(db, { dailyReviewBudget: policy.fatigue.dailyReviewBudget });
  }

  /** Wire the router to `attention.assessment_created` (fire-and-forget). */
  subscribe(): void {
    this.bus.subscribe<AssessmentCreatedPayload>(EventType.AssessmentCreated, (event) => {
      void this.route(event.payload.assessment_id).catch((error) => {
        this.logger?.error('attention routing failed', {
          correlation_id: event.correlation_id,
          assessment_id: event.payload.assessment_id,
          error: String(error),
        });
      });
    });
  }

  /**
   * Route a persisted assessment into the review queue. Returns `null` when the
   * assessment no longer exists. Idempotency is left to the caller (re-routing
   * the same assessment inserts a second, separately-explained row by design).
   */
  async route(assessmentId: AssessmentID): Promise<RoutingOutcome | null> {
    const rows = await this.db
      .select({
        id: assessments.id,
        change_id: assessments.change_id,
        label: assessments.label,
        combined_priority: assessments.combined_priority,
        factors_unavailable: assessments.factors_unavailable,
      })
      .from(assessments)
      .where(eq(assessments.id, assessmentId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }

    const input = await this.toRoutingInput(row);
    const rule = matchRule(this.policy, input);
    const action = rule.action;
    // §4.1 daily budget (Day 13): CRITICAL/HIGH (ESCALATE/REVIEW_REQUIRED) pass
    // always; MEDIUM/LOW beyond the budget are deferred with a `deferred_until`
    // marker — never dropped.
    const deferral = await this.budgetGate.evaluate(action);
    const queueId = newReviewQueueItemID();
    const position = await this.nextPosition();

    await this.db.insert(reviewQueue).values({
      id: queueId,
      task_id: input.taskId,
      assessment_id: assessmentId,
      action,
      policy_version: this.policy.version,
      rule_id: rule.id,
      position,
      status: ReviewQueueStatus.Queued,
      deferred_until: deferral.deferredUntil,
    });

    this.bus.publish(
      createEvent(EventType.AttentionItemRouted, brand(String(input.taskId), 'CorrelationID'), {
        queue_id: queueId,
        assessment_id: assessmentId,
        task_id: input.taskId,
        action,
        policy_version: this.policy.version,
        rule_id: rule.id,
        deferred: deferral.deferred,
      }),
    );

    if (deferral.deferred && deferral.deferredUntil !== null) {
      this.bus.publish(
        createEvent(EventType.AttentionItemDeferred, brand(String(input.taskId), 'CorrelationID'), {
          queue_id: queueId,
          assessment_id: assessmentId,
          task_id: input.taskId,
          deferred_until: deferral.deferredUntil.toISOString(),
        }),
      );
    }

    // Routing metric (day-04 §2): count the enqueue by human vs auto-approvable.
    // AUTO_APPROVABLE needs no human eyes; every other action sends it to people.
    recordRouted(action === 'AUTO_APPROVABLE' ? 'auto_approvable' : 'human');

    return { queueId, action, ruleId: rule.id, deferred: deferral.deferred };
  }

  /** §4.1 feedback loop: record whether an assessment was worth the attention. */
  async reportAssessmentFeedback(
    assessmentId: AssessmentID,
    wasUseful: boolean,
    comment?: string,
  ): Promise<void> {
    const base = {
      id: newAssessmentFeedbackID(),
      assessment_id: assessmentId,
      was_useful: wasUseful,
    };
    await this.db
      .insert(assessmentFeedback)
      .values(comment === undefined ? base : { ...base, comment });
  }

  /** Assemble the policy signals, joining task + flaky onto the assessment row. */
  private async toRoutingInput(
    row: AssessmentRow,
  ): Promise<RoutingInput & { readonly taskId: TaskID }> {
    const taskRows = await this.db
      .select({ task_id: agentRuns.task_id })
      .from(changes)
      .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id))
      .where(eq(changes.id, row.change_id))
      .limit(1);
    const taskId = taskRows[0]?.task_id as TaskID | undefined;
    if (taskId === undefined) {
      throw new Error(`[attention] no task for assessment ${row.id}`);
    }

    const reportRows = await this.db
      .select({ flaky: verificationReports.flaky })
      .from(verificationReports)
      .where(eq(verificationReports.change_id, row.change_id))
      .orderBy(desc(verificationReports.created_at))
      .limit(1);

    return {
      taskId,
      label: row.label as PriorityLabel,
      combinedPriority: row.combined_priority,
      flaky: reportRows[0]?.flaky ?? false,
      factorsUnavailable: row.factors_unavailable as FactorKey[],
    };
  }

  /** FIFO position: one past the current maximum. */
  private async nextPosition(): Promise<number> {
    const rows = await this.db
      .select({ position: reviewQueue.position })
      .from(reviewQueue)
      .orderBy(desc(reviewQueue.position))
      .limit(1);
    return (rows[0]?.position ?? 0) + 1;
  }
}
