/**
 * `AttentionSubscriber` (day-18 §2.4) — scores every task that lands in
 * `AWAITING_REVIEW` and publishes `attention.assessment_created`.
 *
 * The trigger is the `task.state_changed` event with `to_state = AWAITING_REVIEW`
 * (published by the VERIFY step handler after a PASSED verification). On
 * receipt it fetches the task's verification/diffs/trajectory/retry trail,
 * computes the five Phase-1 factors with the corrected formula, inserts an
 * **append-only** `assessments` row, and emits the event Day-19 routing and the
 * Day-22 review queue consume.
 *
 * Each attempt entering AWAITING_REVIEW gets its own row — never an UPDATE
 * (day-18 §6). The single change scored is the task's *latest* change, the one
 * the VERIFY step just verified.
 */

import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { diffLines } from 'diff';

import {
  agentRuns,
  artifacts,
  assessments,
  changes,
  retryLog,
  snapshots,
  trajectorySteps,
  verificationReports,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { brand, EventType, newAssessmentID, TaskStatus } from '@harness/domain';
import type { AssessmentCreatedPayload, TaskID, TaskStateChangedPayload } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';

import {
  extractComplexity,
  extractConfidence,
  extractImpact,
  extractNovelty,
  extractRisk,
} from './factors.js';
import type { VerificationVerdict } from './factors.js';
import { computePriority, labelFor } from './scoring.js';
import type { AttentionAssessment, FactorKey, FactorScores } from './types.js';

/** The latest change row for a task (enough to diff it and anchor the row). */
interface ChangeRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly content_hash: string;
  readonly created_at: Date;
}

export class AttentionSubscriber {
  constructor(private readonly db: DrizzleDB) {}

  /** Attach the AWAITING_REVIEW handler; returns nothing (fire-and-forget). */
  subscribe(bus: IEventBus): void {
    bus.subscribe<TaskStateChangedPayload>(EventType.TaskStateChanged, (event) => {
      if (event.payload.to_state !== TaskStatus.AwaitingReview) {
        return;
      }
      void this.onAwaitingReview(bus, event.payload.task_id).catch((error) => {
        console.error('[attention] assessment failed:', error);
      });
    });
  }

  /**
   * Score a task and persist the assessment. Public so tests (and future
   * re-score paths) can drive it directly without a bus event.
   */
  async assess(taskId: TaskID): Promise<AttentionAssessment | null> {
    const changeRows = await this.db
      .select({
        id: changes.id,
        artifact_id: changes.artifact_id,
        content_hash: changes.content_hash,
        created_at: changes.created_at,
      })
      .from(changes)
      .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id))
      .where(eq(agentRuns.task_id, taskId))
      .orderBy(desc(changes.created_at));

    const primary = changeRows[0];
    if (!primary) {
      return null;
    }

    const artifactIds = [...new Set(changeRows.map((change) => change.artifact_id))];
    const artifactRows = await this.db
      .select({ file_path: artifacts.file_path })
      .from(artifacts)
      .where(inArray(artifacts.id, artifactIds));
    const paths = artifactRows.map((artifact) => artifact.file_path);

    const verdict = await this.fetchVerdict(taskId);
    const retryCount = await this.fetchRetryCount(taskId);
    const stepCount = await this.fetchStepCount(taskId);
    const { addedLines, removedLines } = await this.diffCounts(primary);
    const priorCount = paths.length > 0 ? await this.fetchPriorCount(paths) : 0;

    // Assemble the five factors; `null` results become `0.5` placeholders whose
    // names are recorded in `unavailable` and whose weights are redistributed.
    const unavailable: FactorKey[] = [];
    const risk = extractRisk(verdict, paths);
    const impact = extractImpact(paths.length, paths);
    const confidenceScore = extractConfidence(verdict, retryCount);
    if (risk === null) unavailable.push('risk');
    if (impact === null) unavailable.push('impact');
    if (confidenceScore === null) unavailable.push('confidence');

    const scores: FactorScores = {
      risk: risk ?? 0.5,
      impact: impact ?? 0.5,
      novelty: extractNovelty(priorCount),
      complexity: extractComplexity(addedLines, removedLines, stepCount),
      confidenceScore: confidenceScore ?? 0.5,
    };

    const priority = computePriority(scores, unavailable);
    // All-unavailable guard: refuse to score and default HIGH (fail toward
    // human attention, never away — day-18 §2.3).
    const label = priority === null ? 'HIGH' : labelFor(priority);
    const combinedPriority = priority ?? 0.5;

    const id = newAssessmentID();
    await this.db.insert(assessments).values({
      id,
      artifact_id: primary.artifact_id,
      change_id: primary.id,
      risk_score: scores.risk,
      impact_score: scores.impact,
      novelty_score: scores.novelty,
      complexity_score: scores.complexity,
      confidence_score: scores.confidenceScore,
      combined_priority: combinedPriority,
      label,
      factors_unavailable: unavailable,
    });

    return {
      id,
      taskId,
      changeId: brand(primary.id, 'ChangeID'),
      artifactId: brand(primary.artifact_id, 'ArtifactID'),
      factors: scores,
      factorsUnavailable: unavailable,
      combinedPriority,
      label,
    };
  }

  private async onAwaitingReview(bus: IEventBus, taskId: TaskID): Promise<void> {
    const assessment = await this.assess(taskId);
    if (!assessment) {
      return;
    }
    const payload: AssessmentCreatedPayload = {
      assessment_id: assessment.id,
      artifact_id: assessment.artifactId,
      combined_priority: assessment.combinedPriority,
      label: assessment.label,
    };
    bus.publish(createEvent(EventType.AssessmentCreated, brand(taskId, 'CorrelationID'), payload));
  }

  /** Latest verification report → the four-way `VerificationVerdict`, or null. */
  private async fetchVerdict(taskId: TaskID): Promise<VerificationVerdict | null> {
    const rows = await this.db
      .select({ overall: verificationReports.overall, flaky: verificationReports.flaky })
      .from(verificationReports)
      .where(eq(verificationReports.task_id, taskId))
      .orderBy(desc(verificationReports.created_at))
      .limit(1);
    const report = rows[0];
    if (!report) {
      return null;
    }
    if (report.overall === 'FAILED') {
      return 'FAILED';
    }
    if (report.flaky) {
      return 'FLAKY';
    }
    return 'PASSED';
  }

  private async fetchRetryCount(taskId: TaskID): Promise<number> {
    const rows = await this.db
      .select({ id: retryLog.id })
      .from(retryLog)
      .where(eq(retryLog.task_id, taskId));
    return rows.length;
  }

  private async fetchStepCount(taskId: TaskID): Promise<number> {
    const rows = await this.db
      .select({ id: trajectorySteps.id })
      .from(trajectorySteps)
      .innerJoin(agentRuns, eq(agentRuns.id, trajectorySteps.agent_run_id))
      .where(eq(agentRuns.task_id, taskId));
    return rows.length;
  }

  /** Prior assessments touching any of the same paths (novelty history). */
  private async fetchPriorCount(paths: readonly string[]): Promise<number> {
    const rows = await this.db
      .select({ id: assessments.id })
      .from(assessments)
      .innerJoin(artifacts, eq(artifacts.id, assessments.artifact_id))
      .where(inArray(artifacts.file_path, paths));
    return rows.length;
  }

  /**
   * Line counts for the change's diff against its previous base snapshot.
   *
   * attention-engine may not import `@harness/artifact-tracker`'s DiffEngine
   * (boundary R4), so the diff is recomputed here from the same content-addressed
   * snapshots with the shared `diff` package (day-18 §2.2 "DiffEngine counts").
   */
  private async diffCounts(
    change: ChangeRow,
  ): Promise<{ addedLines: number; removedLines: number }> {
    const current = await this.contentFor(change.content_hash);

    const baseRows = await this.db
      .select({ content_hash: changes.content_hash })
      .from(changes)
      .where(
        and(eq(changes.artifact_id, change.artifact_id), lt(changes.created_at, change.created_at)),
      )
      .orderBy(desc(changes.created_at))
      .limit(1);
    const baseHash = baseRows[0]?.content_hash;
    const base = baseHash === undefined ? '' : await this.contentFor(baseHash);

    const parts = diffLines(base, current);
    const addedLines = parts.reduce((sum, part) => sum + (part.added ? part.count : 0), 0);
    const removedLines = parts.reduce((sum, part) => sum + (part.removed ? part.count : 0), 0);
    return { addedLines, removedLines };
  }

  private async contentFor(hash: string): Promise<string> {
    const rows = await this.db
      .select({ content: snapshots.content })
      .from(snapshots)
      .where(eq(snapshots.content_hash, hash))
      .limit(1);
    return rows[0]?.content ?? '';
  }
}
