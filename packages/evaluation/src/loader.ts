/**
 * Windowed, read-only loader (day-06 §2.2, §3.2).
 *
 * Reads the append-only store — never the live pipeline — and reduces it to the
 * plain row set {@link MetricsComputer} is pure over. Three queries: human
 * decisions (joined to assessment label + queue claim time for dwell), rework
 * transitions, and `attention.item_routed` route events (with their assessment
 * label). These are also the read surface the replay engine (Day 08) re-runs, so
 * they stay pure and windowed — a loader with side effects would make replay
 * non-deterministic.
 */

import { and, eq, gte, inArray, lte } from 'drizzle-orm';

import {
  assessments,
  decisions,
  eventLog,
  reviewQueue,
  shadowRankComparisons,
  taskStateHistory,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { AttentionItemRoutedPayload } from '@harness/domain';
import { EventType } from '@harness/domain';

import type { DecisionRow, MetricsInput, ReworkRow, RouteRow, ShadowRow } from './report.js';

const DEFECT_STATES: readonly string[] = ['REWORK', 'AWAITING_HUMAN_INTERVENTION'];

export interface MetricsWindow {
  readonly from: Date;
  readonly to: Date;
}

/** Load the windowed rows from the store and assemble a {@link MetricsInput}. */
export async function loadMetricsInput(
  db: DrizzleDB,
  window: MetricsWindow,
): Promise<MetricsInput> {
  const { from, to } = window;

  const [decisionLog, reworkLog, routeLog, shadowLog] = await Promise.all([
    loadDecisions(db, from, to),
    loadRework(db, from, to),
    loadRoutes(db, from, to),
    loadShadowComparisons(db, from, to),
  ]);

  return { from, to, decisionLog, reworkLog, routeLog, shadowLog };
}

async function loadDecisions(db: DrizzleDB, from: Date, to: Date): Promise<DecisionRow[]> {
  const rows = await db
    .select({
      decisionId: decisions.id,
      assessmentId: decisions.assessment_id,
      changeId: decisions.change_id,
      decision: decisions.decision,
      createdAt: decisions.created_at,
      claimedAt: reviewQueue.claimed_at,
      label: assessments.label,
    })
    .from(decisions)
    .innerJoin(assessments, eq(assessments.id, decisions.assessment_id))
    .innerJoin(reviewQueue, eq(reviewQueue.assessment_id, decisions.assessment_id))
    .where(and(gte(decisions.created_at, from), lte(decisions.created_at, to)));

  // A re-reviewed assessment may match several queue rows; keep the latest
  // decision per assessment and prefer a row with a claim time for dwell.
  const byDecisionId = new Map<string, DecisionRow>();
  for (const row of rows) {
    const dwellSeconds =
      row.claimedAt !== null
        ? Math.max(0, (row.createdAt.getTime() - row.claimedAt.getTime()) / 1000)
        : undefined;
    const candidate: DecisionRow = {
      decisionId: row.decisionId,
      assessmentId: row.assessmentId,
      changeId: row.changeId,
      decision: row.decision,
      createdAt: row.createdAt,
      ...(dwellSeconds !== undefined ? { dwellSeconds } : {}),
      ...(row.label !== null ? { label: row.label } : {}),
    };
    const existing = byDecisionId.get(row.decisionId);
    if (
      !existing ||
      (existing.dwellSeconds === undefined && candidate.dwellSeconds !== undefined)
    ) {
      byDecisionId.set(row.decisionId, candidate);
    }
  }
  return [...byDecisionId.values()];
}

async function loadRework(db: DrizzleDB, from: Date, to: Date): Promise<ReworkRow[]> {
  const rows = await db
    .select({
      taskId: taskStateHistory.task_id,
      toState: taskStateHistory.to_state,
      occurredAt: taskStateHistory.occurred_at,
    })
    .from(taskStateHistory)
    .where(
      and(
        inArray(taskStateHistory.to_state, [...DEFECT_STATES]),
        gte(taskStateHistory.occurred_at, from),
        lte(taskStateHistory.occurred_at, to),
      ),
    );
  return rows.map((row) => ({
    taskId: row.taskId,
    toState: row.toState,
    occurredAt: row.occurredAt,
  }));
}

async function loadRoutes(db: DrizzleDB, from: Date, to: Date): Promise<RouteRow[]> {
  const events = await db
    .select({ payload: eventLog.payload, occurredAt: eventLog.occurred_at })
    .from(eventLog)
    .where(
      and(
        eq(eventLog.event_type, EventType.AttentionItemRouted),
        gte(eventLog.occurred_at, from),
        lte(eventLog.occurred_at, to),
      ),
    );

  const routes: RouteRow[] = events.map((event) => {
    const payload = event.payload as unknown as AttentionItemRoutedPayload;
    return {
      queueId: payload.queue_id,
      assessmentId: payload.assessment_id,
      taskId: payload.task_id,
      action: payload.action,
      occurredAt: event.occurredAt,
    };
  });

  // Attach assessment labels (for inflation) in one follow-up query.
  const assessmentIds = [...new Set(routes.map((route) => route.assessmentId))];
  if (assessmentIds.length === 0) {
    return routes;
  }
  const labelRows = await db
    .select({ id: assessments.id, label: assessments.label })
    .from(assessments)
    .where(inArray(assessments.id, assessmentIds));
  const labelById = new Map(labelRows.map((row) => [row.id, row.label]));

  return routes.map((route) => {
    const label = labelById.get(route.assessmentId);
    return label !== undefined ? { ...route, label } : route;
  });
}

/**
 * Shadow rank-comparison rows (day-18 §2.4), windowed by their write time. This
 * is the day-25 report's windowed shadow signal — the *only* Week-5 telemetry
 * with DB history; cache/sandbox/object-store counters are continuous and come in
 * via `infraCounters` (a live snapshot), not the store.
 */
async function loadShadowComparisons(db: DrizzleDB, from: Date, to: Date): Promise<ShadowRow[]> {
  const rows = await db
    .select({
      comparisonId: shadowRankComparisons.id,
      rankCorrelation: shadowRankComparisons.rank_correlation,
    })
    .from(shadowRankComparisons)
    .where(
      and(gte(shadowRankComparisons.created_at, from), lte(shadowRankComparisons.created_at, to)),
    );

  return rows.map((row) => ({
    comparisonId: row.comparisonId,
    rankCorrelation: row.rankCorrelation === null ? null : Number(row.rankCorrelation),
  }));
}
