/**
 * `AttentionRouter` (day-19 §2.3) — turns an assessment into a routing decision
 * and enqueues it into `review_queue`.
 *
 * The router subscribes to `attention.assessment_created`; on receipt it re-loads
 * the assessment plus the signals the policy needs (task id, flaky verdict),
 * matches a policy rule, applies §4.1 fatigue controls, and inserts an
 * **append-only, explainable** queue row (rule id + policy version + action).
 *
 * §4.1 alert-fatigue is host-side discipline:
 *  - a daily review budget defers low-severity items (never drops them);
 *  - adaptive thresholds nudge the HIGH band up when reviewers say "not useful";
 *  - an inflation monitor detects the engine systematically over-prioritising.
 * The budget count is **UTC** day-boundary (day-19 §6).
 */

import { and, desc, eq, gte, inArray } from 'drizzle-orm';

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
  newCorrelationID,
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
import type { Logger } from '@harness/di';

import { ATTENTION_POLICY_V1, matchRule } from './policy.js';
import type { AttentionPolicy, RoutingInput } from './policy.js';
import type { FactorKey, PriorityLabel } from './types.js';

/** The mutable HIGH-band lower bound (day-19 §4.1). */
export const HIGH_THRESHOLD_MIN = 0.6;
export const HIGH_THRESHOLD_MAX = 0.8;

/** The result of routing one assessment. */
export interface RoutingOutcome {
  readonly queueId: ReviewQueueItemID;
  readonly action: RoutingAction;
  readonly ruleId: string;
  /** True when the budget deferred this item (still QUEUED, flagged). */
  readonly deferred: boolean;
}

/** Midnight UTC for a given instant — fatigue math is timezone-explicit (§6). */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Nudge the HIGH threshold up when a disproportionate share of HIGH items were
 * judged "not useful", bounded to `[0.60, 0.80]` (day-19 §4.1). Pure.
 */
export function adjustHighThreshold(current: number, notUsefulRatio: number): number {
  const clamped = Math.min(HIGH_THRESHOLD_MAX, Math.max(HIGH_THRESHOLD_MIN, current));
  if (notUsefulRatio <= 0.8) {
    return clamped;
  }
  return Math.min(HIGH_THRESHOLD_MAX, clamped + 0.05);
}

/** Mean-combined-priority ratio (this week / previous week). Pure. */
export function computeInflationRatio(thisWeekMean: number, previousWeekMean: number): number {
  if (previousWeekMean <= 0) {
    return thisWeekMean > 0 ? Number.POSITIVE_INFINITY : 1;
  }
  return thisWeekMean / previousWeekMean;
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
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly policy: AttentionPolicy = ATTENTION_POLICY_V1,
    private readonly logger?: Logger,
  ) {}

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
    const { action, deferred } = await this.applyFatigueControls(rule.action);
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
    });

    this.bus.publish(
      createEvent(EventType.AttentionItemRouted, brand(String(input.taskId), 'CorrelationID'), {
        queue_id: queueId,
        assessment_id: assessmentId,
        task_id: input.taskId,
        action,
        policy_version: this.policy.version,
        rule_id: rule.id,
        deferred,
      }),
    );

    return { queueId, action, ruleId: rule.id, deferred };
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

  /**
   * On-demand adaptive-threshold pass (Phase 1 has no cron). If >80% of the last
   * week's HIGH items were judged "not useful", raise the HIGH threshold +0.05
   * and emit `attention.threshold_adjusted`. Returns the before/after, or null
   * when no adjustment is warranted.
   */
  async runThresholdAdjustment(): Promise<{ from: number; to: number } | null> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const highRows = await this.db
      .select({ id: assessments.id })
      .from(assessments)
      .where(and(eq(assessments.label, 'HIGH'), gte(assessments.created_at, cutoff)));
    if (highRows.length === 0) {
      return null;
    }

    const feedbackRows = await this.db
      .select({ was_useful: assessmentFeedback.was_useful })
      .from(assessmentFeedback)
      .where(
        inArray(
          assessmentFeedback.assessment_id,
          highRows.map((row) => row.id),
        ),
      );
    if (feedbackRows.length === 0) {
      return null;
    }

    const notUsefulRatio =
      feedbackRows.filter((row) => !row.was_useful).length / feedbackRows.length;
    const from = HIGH_THRESHOLD_MIN;
    const to = adjustHighThreshold(from, notUsefulRatio);
    if (to === from) {
      return null;
    }

    this.bus.publish(
      createEvent(EventType.AttentionThresholdAdjusted, newCorrelationID(), {
        label: 'HIGH',
        from,
        to,
      }),
    );
    return { from, to };
  }

  /**
   * On-demand inflation monitor. Emits `attention.inflation_detected` when this
   * week's mean combined priority exceeds last week's by `inflationAlertRatio`.
   */
  async runInflationCheck(): Promise<{ ratio: number; alertRatio: number } | null> {
    const { inflationWindowDays: windowDays, inflationAlertRatio: alertRatio } =
      this.policy.fatigue;
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const thisWeekStart = now - windowDays * day;

    const rows = await this.db
      .select({
        combined_priority: assessments.combined_priority,
        created_at: assessments.created_at,
      })
      .from(assessments)
      .where(gte(assessments.created_at, new Date(now - 2 * windowDays * day)));

    let thisWeekSum = 0;
    let thisWeekCount = 0;
    let previousWeekSum = 0;
    let previousWeekCount = 0;
    for (const row of rows) {
      if (row.created_at.getTime() >= thisWeekStart) {
        thisWeekSum += row.combined_priority;
        thisWeekCount += 1;
      } else {
        previousWeekSum += row.combined_priority;
        previousWeekCount += 1;
      }
    }

    const ratio = computeInflationRatio(
      thisWeekCount > 0 ? thisWeekSum / thisWeekCount : 0,
      previousWeekCount > 0 ? previousWeekSum / previousWeekCount : 0,
    );
    if (ratio <= alertRatio) {
      return null;
    }

    this.bus.publish(
      createEvent(EventType.AttentionInflationDetected, newCorrelationID(), {
        ratio,
        alert_ratio: alertRatio,
        window_days: windowDays,
      }),
    );
    return { ratio, alertRatio };
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

  /**
   * §4.1 daily budget: ESCALATE/REVIEW_REQUIRED never defer; low-severity items
   * defer (flag only — they stay QUEUED) once today's DECIDED+CLAIMED exceeds the
   * budget. UTC day boundary.
   */
  private async applyFatigueControls(
    rawAction: RoutingAction,
  ): Promise<{ action: RoutingAction; deferred: boolean }> {
    if (rawAction === 'ESCALATE' || rawAction === 'REVIEW_REQUIRED') {
      return { action: rawAction, deferred: false };
    }

    const spent = await this.db
      .select({ id: reviewQueue.id })
      .from(reviewQueue)
      .where(
        and(
          gte(reviewQueue.created_at, startOfUtcDay(new Date())),
          inArray(reviewQueue.status, [ReviewQueueStatus.Decided, ReviewQueueStatus.Claimed]),
        ),
      );
    const deferred = spent.length >= this.policy.fatigue.dailyReviewBudget;
    return { action: rawAction, deferred };
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
