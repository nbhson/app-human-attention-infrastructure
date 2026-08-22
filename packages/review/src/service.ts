/**
 * `ReviewService` (day-22 §2, day-23 §2) — the review backend behind `apps/api`'s
 * routes.
 *
 * Claim / decide / drop are the only mutations, and every one is a *guarded*
 * write over `review_queue` status (optimistic concurrency), so two recent claims
 * resolve to exactly one winner and everything else is a 409/state error. The
 * service never touches `changes.status` — that stays the ChangeStatusSubscriber's
 * job (day-14 §2.5); it only publishes `review.decision_submitted` and lets the
 * subscriber flip the change to REVIEWED.
 *
 * Day 23 adds the read models the review UI renders: the queue list carries label
 * / score / flaky, and the detail composes the five factor scores, the
 * verification checks (with evidence links), and the change's diffs — the last
 * via an injected `DiffProvider` seam (R6; review may not import artifact-tracker).
 */

import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import {
  assessments,
  decisions,
  evidence,
  reviewQueue,
  tasks,
  verificationCheckResults,
  verificationReports,
} from '@harness/db';
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
  DecisionSubmittedPayload,
  EvidenceID,
  HumanDecisionType as DecisionType,
  ReviewerID,
  ReviewQueueItemID,
} from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { withSpan } from '@harness/observability';
import type { Logger } from '@harness/di';

import {
  EvidenceNotFoundError,
  MissingRationaleError,
  QueueConflictError,
  QueueItemNotFoundError,
  QueueStateError,
} from './types.js';
import type {
  DecisionInput,
  DiffProvider,
  DropInput,
  EvidenceRecord,
  FactorScore,
  FeedbackReporter,
  QueueItem,
  QueueItemDetail,
  QueueListItem,
  ReviewFactorKey,
  TaskTransition,
  VerificationCheckView,
} from './types.js';

/** The row the service re-loads before acting (queue + its assessment). */
interface QueueRow {
  readonly id: string;
  readonly task_id: string;
  readonly assessment_id: string;
  readonly change_id: string;
  readonly action: string;
  readonly policy_version: number;
  readonly rule_id: string;
  readonly position: number;
  readonly status: string;
  readonly claimed_by: string | null;
  readonly claimed_at: Date | null;
  readonly created_at: Date;
  readonly label: string;
  readonly combined_priority: number;
}

/** The assessment factor columns needed for the "why" panel (day-23 §2.3). */
interface AssessmentFactorRow {
  readonly risk_score: number;
  readonly impact_score: number;
  readonly novelty_score: number;
  readonly complexity_score: number;
  readonly confidence_score: number;
  readonly factors_unavailable: unknown;
}

/** The five factors, in display order (day-18 §2). */
const FACTOR_KEYS: readonly ReviewFactorKey[] = [
  'risk',
  'impact',
  'novelty',
  'complexity',
  'confidence',
];

/** The columns shared by list + detail reads (queue joined to its assessment). */
const QUEUE_COLUMNS = {
  id: reviewQueue.id,
  task_id: reviewQueue.task_id,
  assessment_id: reviewQueue.assessment_id,
  change_id: assessments.change_id,
  action: reviewQueue.action,
  policy_version: reviewQueue.policy_version,
  rule_id: reviewQueue.rule_id,
  position: reviewQueue.position,
  status: reviewQueue.status,
  claimed_by: reviewQueue.claimed_by,
  claimed_at: reviewQueue.claimed_at,
  created_at: reviewQueue.created_at,
  label: assessments.label,
  combined_priority: assessments.combined_priority,
} as const;

const ASSESSMENT_FACTOR_COLUMNS = {
  risk_score: assessments.risk_score,
  impact_score: assessments.impact_score,
  novelty_score: assessments.novelty_score,
  complexity_score: assessments.complexity_score,
  confidence_score: assessments.confidence_score,
  factors_unavailable: assessments.factors_unavailable,
} as const;

export class ReviewService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly taskTransition: TaskTransition,
    private readonly reportFeedback: FeedbackReporter,
    private readonly diffProvider?: DiffProvider,
    private readonly logger?: Logger,
  ) {}

  /**
   * List the queue in priority order: ascending `position` is FIFO (day-22 §2.1).
   * When `status` is given, only rows in that queue status are returned.
   */
  async listQueue(status?: string): Promise<QueueListItem[]> {
    const base = this.db
      .select(QUEUE_COLUMNS)
      .from(reviewQueue)
      .innerJoin(assessments, eq(assessments.id, reviewQueue.assessment_id))
      .orderBy(asc(reviewQueue.position));
    const rows = await (status ? base.where(eq(reviewQueue.status, status)) : base);

    const taskIds = [...new Set(rows.map((row) => row.task_id))];
    const changeIds = [...new Set(rows.map((row) => row.change_id))];

    const [taskTitles, flakyByChange] = await Promise.all([
      this.taskTitles(taskIds),
      this.latestFlaky(changeIds),
    ]);

    return rows.map((row) =>
      toQueueListItem(
        row,
        taskTitles.get(row.task_id) ?? '',
        flakyByChange.get(row.change_id) ?? false,
      ),
    );
  }

  /** Compose the read-only detail payload (day-22 §2.4 + day-23 §2.3). */
  async getDetail(queueId: ReviewQueueItemID): Promise<QueueItemDetail> {
    const row = await this.mustGetRow(queueId);

    const [taskRows, decisionRows, assessmentRows, checks, diffs] = await Promise.all([
      this.db
        .select({ title: tasks.title, state: tasks.state })
        .from(tasks)
        .where(eq(tasks.id, row.task_id))
        .limit(1),
      this.db
        .select({
          decision: decisions.decision,
          reviewer_id: decisions.reviewer_id,
          rationale: decisions.rationale,
          created_at: decisions.created_at,
        })
        .from(decisions)
        .where(eq(decisions.assessment_id, row.assessment_id))
        .orderBy(desc(decisions.created_at))
        .limit(1),
      this.db
        .select(ASSESSMENT_FACTOR_COLUMNS)
        .from(assessments)
        .where(eq(assessments.id, row.assessment_id))
        .limit(1),
      this.checksFor(row.change_id),
      this.diffProvider
        ? this.diffProvider.diffChange(brand(row.change_id, 'ChangeID'))
        : Promise.resolve([]),
    ]);

    const latest = decisionRows[0];
    return {
      ...toQueueItem(row),
      label: row.label,
      combinedPriority: row.combined_priority,
      ruleId: row.rule_id,
      policyVersion: row.policy_version,
      taskTitle: taskRows[0]?.title ?? '',
      taskState: taskRows[0]?.state ?? '',
      factors: toFactors(assessmentRows[0] as AssessmentFactorRow | undefined),
      checks,
      diffs,
      decision: latest
        ? {
            decision: latest.decision as DecisionType,
            reviewerId: brand(latest.reviewer_id, 'ReviewerID'),
            rationale: latest.rationale,
            at: latest.created_at,
          }
        : null,
    };
  }

  /** Fetch an evidence body by id, for the evidence modal (day-23 §2.3). */
  async getEvidence(evidenceId: EvidenceID): Promise<EvidenceRecord> {
    const rows = await this.db
      .select({ id: evidence.id, kind: evidence.kind, body: evidence.body })
      .from(evidence)
      .where(eq(evidence.id, evidenceId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new EvidenceNotFoundError(evidenceId);
    }
    return { id: brand(row.id, 'EvidenceID'), kind: row.kind, body: row.body };
  }

  /** Claim a QUEUED item for a reviewer; a second claim loses with a 409 (§2.2). */
  async claim(queueId: ReviewQueueItemID, reviewerId: ReviewerID): Promise<QueueItemDetail> {
    const updated = await this.db
      .update(reviewQueue)
      .set({ status: ReviewQueueStatus.Claimed, claimed_by: reviewerId, claimed_at: new Date() })
      .where(and(eq(reviewQueue.id, queueId), eq(reviewQueue.status, ReviewQueueStatus.Queued)))
      .returning({ id: reviewQueue.id });

    if (updated.length === 0) {
      throw new QueueConflictError(queueId);
    }
    return this.getDetail(queueId);
  }

  /** Submit a decision on a CLAIMED item (day-22 §2.3). */
  async decide(queueId: ReviewQueueItemID, input: DecisionInput): Promise<QueueItemDetail> {
    const row = await this.mustGetRow(queueId);
    if (row.status !== ReviewQueueStatus.Claimed) {
      throw new QueueStateError(queueId, ReviewQueueStatus.Claimed, row.status);
    }

    const correlationId = row.task_id;
    return withSpan(
      {
        spanName: 'review.decide',
        ctx: { correlationId, taskId: brand(row.task_id, 'TaskID') },
        attributes: {
          'harness.review.queue_id': queueId,
          'harness.review.decision': input.decision,
        },
      },
      async () => {
        const decision =
          input.decision === 'APPROVE' ? HumanDecisionType.Approved : HumanDecisionType.Rejected;
        const target = input.decision === 'APPROVE' ? TaskStatus.Approved : TaskStatus.Rejected;

        // 1. Guarded queue flip: CLAIMED → DECIDED (a second decide is a state error).
        const flipped = await this.db
          .update(reviewQueue)
          .set({ status: ReviewQueueStatus.Decided })
          .where(
            and(eq(reviewQueue.id, queueId), eq(reviewQueue.status, ReviewQueueStatus.Claimed)),
          )
          .returning({ id: reviewQueue.id });
        if (flipped.length === 0) {
          throw new QueueStateError(queueId, ReviewQueueStatus.Claimed, row.status);
        }

        // 2. Record the decision (auditable, never silent).
        const decisionId = newDecisionID();
        const changeId = brand(row.change_id, 'ChangeID');
        const assessmentId = brand(row.assessment_id, 'AssessmentID');
        await this.db.insert(decisions).values({
          id: decisionId,
          correlation_id: row.task_id,
          change_id: changeId,
          assessment_id: assessmentId,
          decision,
          reviewer_id: input.reviewerId,
          actor_id: input.actorId,
          actor_email: input.actorEmail,
          rationale: input.rationale,
        });

        // 3. Drive the task transition (injected seam → TaskService).
        await this.taskTransition.transitionTask(brand(row.task_id, 'TaskID'), target, 'human', {
          rationale: input.rationale,
          expectedFrom: TaskStatus.AwaitingReview,
        });

        // 4. Publish the event; ChangeStatusSubscriber flips the change → REVIEWED.
        //    event_version 2 (day-02 §2.4): `actor_id` added; `reviewer_id` kept so
        //    Phase-1 consumers stay unbroken.
        const payload: DecisionSubmittedPayload = {
          decision_id: decisionId,
          change_id: changeId,
          decision,
          reviewer_id: input.reviewerId,
          actor_id: input.actorId,
        };
        this.bus.publish(
          createEvent(EventType.DecisionSubmitted, brand(row.task_id, 'CorrelationID'), payload, 2),
        );

        // 5. Feed the alert-fatigue loop — best-effort, must not roll back the decision.
        try {
          await this.reportFeedback.reportAssessmentFeedback(
            assessmentId,
            input.wasUseful,
            input.comment,
          );
        } catch (error) {
          this.logger?.error('review: record feedback failed (best-effort)', {
            correlation_id: row.task_id,
            error: String(error),
          });
        }

        return this.getDetail(queueId);
      },
    );
  }

  /** Drop a QUEUED/CLAIMED item; the rationale is recorded, never silent (§2.1). */
  async drop(queueId: ReviewQueueItemID, input: DropInput): Promise<void> {
    if (input.rationale.trim().length === 0) {
      throw new MissingRationaleError();
    }
    const row = await this.mustGetRow(queueId);

    const updated = await this.db
      .update(reviewQueue)
      .set({ status: ReviewQueueStatus.Dropped })
      .where(
        and(
          eq(reviewQueue.id, queueId),
          inArray(reviewQueue.status, [ReviewQueueStatus.Queued, ReviewQueueStatus.Claimed]),
        ),
      )
      .returning({ id: reviewQueue.id });
    if (updated.length === 0) {
      throw new QueueStateError(queueId, 'QUEUED | CLAIMED', row.status);
    }

    // Record the drop as a DEFERRED decision so the rationale is auditable.
    await this.db.insert(decisions).values({
      id: newDecisionID(),
      correlation_id: row.task_id,
      change_id: brand(row.change_id, 'ChangeID'),
      assessment_id: brand(row.assessment_id, 'AssessmentID'),
      decision: HumanDecisionType.Deferred,
      reviewer_id: input.reviewerId,
      actor_id: input.actorId,
      actor_email: input.actorEmail,
      rationale: input.rationale,
    });
  }

  /** `tasks -> title` lookup for a batch of task ids. */
  private async taskTitles(taskIds: string[]): Promise<Map<string, string>> {
    if (taskIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(inArray(tasks.id, taskIds));
    return new Map(rows.map((row) => [row.id, row.title]));
  }

  /** Latest `flaky` flag per change, for the queue's FLAKY marker (day-23 §2.2). */
  private async latestFlaky(changeIds: string[]): Promise<Map<string, boolean>> {
    if (changeIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ change_id: verificationReports.change_id, flaky: verificationReports.flaky })
      .from(verificationReports)
      .where(inArray(verificationReports.change_id, changeIds))
      .orderBy(desc(verificationReports.created_at));
    const map = new Map<string, boolean>();
    for (const row of rows) {
      if (!map.has(row.change_id)) {
        map.set(row.change_id, row.flaky);
      }
    }
    return map;
  }

  /** The verification checks (with evidence links) for a change's latest report. */
  private async checksFor(changeId: string): Promise<readonly VerificationCheckView[]> {
    const reportRows = await this.db
      .select({ id: verificationReports.id })
      .from(verificationReports)
      .where(eq(verificationReports.change_id, changeId))
      .orderBy(desc(verificationReports.created_at))
      .limit(1);
    const reportId = reportRows[0]?.id;
    if (!reportId) {
      return [];
    }
    const rows = await this.db
      .select({
        kind: verificationCheckResults.check_kind,
        status: verificationCheckResults.status,
        evidenceId: verificationCheckResults.evidence_id,
      })
      .from(verificationCheckResults)
      .where(eq(verificationCheckResults.report_id, reportId))
      .orderBy(asc(verificationCheckResults.created_at));
    return rows.map((row) => ({
      kind: row.kind,
      status: row.status,
      evidenceId: row.evidenceId,
    }));
  }

  private async mustGetRow(queueId: ReviewQueueItemID): Promise<QueueRow> {
    const rows = await this.db
      .select(QUEUE_COLUMNS)
      .from(reviewQueue)
      .innerJoin(assessments, eq(assessments.id, reviewQueue.assessment_id))
      .where(eq(reviewQueue.id, queueId))
      .limit(1);
    const row = rows[0] as QueueRow | undefined;
    if (!row) {
      throw new QueueItemNotFoundError(queueId);
    }
    return row;
  }
}

/** Map a queue+assessment join row onto the public read model. */
function toQueueItem(row: QueueRow): QueueItem {
  return {
    id: brand(row.id, 'ReviewQueueItemID'),
    taskId: brand(row.task_id, 'TaskID'),
    assessmentId: brand(row.assessment_id, 'AssessmentID'),
    changeId: brand(row.change_id, 'ChangeID'),
    action: row.action,
    position: row.position,
    status: row.status,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
  };
}

/** Map a list row onto the queue-list read model (day-23 §2.2). */
function toQueueListItem(row: QueueRow, taskTitle: string, flaky: boolean): QueueListItem {
  return {
    ...toQueueItem(row),
    label: row.label,
    combinedPriority: row.combined_priority,
    taskTitle,
    flaky,
    ruleId: row.rule_id,
    policyVersion: row.policy_version,
  };
}

/** The column value for a factor key. */
function factorValue(key: ReviewFactorKey, row: AssessmentFactorRow): number {
  switch (key) {
    case 'risk':
      return row.risk_score;
    case 'impact':
      return row.impact_score;
    case 'novelty':
      return row.novelty_score;
    case 'complexity':
      return row.complexity_score;
    case 'confidence':
      return row.confidence_score;
  }
}

/** The five factors, each flagged available/unavailable (day-23 §2.3). */
function toFactors(row: AssessmentFactorRow | undefined): FactorScore[] {
  const unavailable = (row?.factors_unavailable as readonly string[] | undefined) ?? [];
  const unavailableSet = new Set(unavailable);
  return FACTOR_KEYS.map((key) => ({
    key,
    score: row ? factorValue(key, row) : 0,
    available: !unavailableSet.has(key),
  }));
}
