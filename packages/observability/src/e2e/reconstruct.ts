/**
 * Telemetry reconstruction (day-27 §2.2 / §3.3).
 *
 * Given a `correlation_id` (the task lifecycle id — == `tasks.id`), this replays
 * the *whole* observed run from the append-only stores: it joins the OTel
 * `trace_correlation` row back to its `trace_id`, re-reads the `event_log` in
 * causal order, and dumps the decision + verification history that the run left
 * behind. It exists to make the Day-27 acceptance literal — a pipeline you can't
 * reconstruct is not a Phase-2 pipeline (Spec 10) — so it **asserts** the two
 * telemetry-integrity invariants rather than just returning rows:
 *
 *   - every `review.decision_submitted` event carries a non-null `actor_id`
 *     (Days 1–2 identity attribution);
 *   - every `verification_reports` row carries a non-null `content_hash`
 *     (Day 22 attributability).
 *
 * A violation throws {@link TelemetryIntegrityError} — a red run, not a warning.
 * The `traceId` is *returned* (nullable) rather than asserted: the E2E driver is
 * the layer that decides a missing trace is fatal, because only it knows whether
 * tracing was enabled for the environment the run happened under.
 *
 * This module sits in `@harness/observability` next to the tracer/meter (R8): it
 * reads only the DB schema + domain event vocabulary, never spins up a provider.
 */

import { eq } from 'drizzle-orm';

import { decisions, eventLog, traceCorrelation, verificationReports } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { EventType } from '@harness/domain';

/** A telemetry-integrity assertion failed — the run is observable *and* broken. */
export class TelemetryIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelemetryIntegrityError';
  }
}

/** One replayed `event_log` row, in causal order. */
export interface ReconstructedEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  /** Null when the event fired outside an authenticated request (loops, subs). */
  readonly actorId: string | null;
  readonly payload: unknown;
}

/** One decision row the run wrote (the "decision history" dump). */
export interface ReconstructedDecision {
  readonly id: string;
  readonly decision: string;
  readonly actorId: string | null;
  readonly rationale: string | null;
  readonly createdAt: Date;
}

/** One verification report the run wrote (the "what was verified" dump). */
export interface ReconstructedVerification {
  readonly id: string;
  readonly overall: string;
  readonly contentHash: string | null;
  readonly durationMs: number;
  readonly createdAt: Date;
}

/** The reconstructed, cross-store view of a single task lifecycle. */
export interface ReconstructedRun {
  readonly correlationId: string;
  /** Hex OTel trace id, or null when no root span wrote `trace_correlation`. */
  readonly traceId: string | null;
  readonly events: readonly ReconstructedEvent[];
  readonly decisions: readonly ReconstructedDecision[];
  readonly verifications: readonly ReconstructedVerification[];
}

/**
 * Reconstruct a task lifecycle from its correlation id, asserting the review /
 * verification steps were attributed (actor) and attributable (content hash).
 */
export async function reconstruct(db: DrizzleDB, correlationId: string): Promise<ReconstructedRun> {
  const [traces, events, decisionRows, verificationRows] = await Promise.all([
    db
      .select({ traceId: traceCorrelation.trace_id })
      .from(traceCorrelation)
      .where(eq(traceCorrelation.correlation_id, correlationId))
      .limit(1),
    db
      .select({
        eventId: eventLog.event_id,
        eventType: eventLog.event_type,
        occurredAt: eventLog.occurred_at,
        actorId: eventLog.actor_id,
        payload: eventLog.payload,
      })
      .from(eventLog)
      .where(eq(eventLog.correlation_id, correlationId))
      .orderBy(eventLog.occurred_at, eventLog.event_id),
    db
      .select({
        id: decisions.id,
        decision: decisions.decision,
        actorId: decisions.actor_id,
        rationale: decisions.rationale,
        createdAt: decisions.created_at,
      })
      .from(decisions)
      .where(eq(decisions.correlation_id, correlationId))
      .orderBy(decisions.created_at),
    db
      .select({
        id: verificationReports.id,
        overall: verificationReports.overall,
        contentHash: verificationReports.content_hash,
        durationMs: verificationReports.duration_ms,
        createdAt: verificationReports.created_at,
      })
      .from(verificationReports)
      .where(eq(verificationReports.correlation_id, correlationId))
      .orderBy(verificationReports.created_at),
  ]);

  // Review step must be attributed (day-02 §2.4): a decision_submitted with no
  // actor is an un-attributable — and therefore unusable — review record.
  const unattributed = events.filter(
    (event) => event.eventType === EventType.DecisionSubmitted && event.actorId === null,
  );
  if (unattributed.length > 0) {
    throw new TelemetryIntegrityError(
      `${EventType.DecisionSubmitted} without actor_id (${unattributed.length} row(s))`,
    );
  }

  // Verification step must be attributable to exact bytes (day-22 §5.5).
  const unhashed = verificationRows.filter((row) => row.contentHash === null);
  if (unhashed.length > 0) {
    throw new TelemetryIntegrityError(
      `verification_reports without content_hash (${unhashed.length} row(s))`,
    );
  }

  return {
    correlationId,
    traceId: traces[0]?.traceId ?? null,
    events: events.map((event) => ({
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      actorId: event.actorId,
      payload: event.payload,
    })),
    decisions: decisionRows.map((row) => ({
      id: row.id,
      decision: row.decision,
      actorId: row.actorId,
      rationale: row.rationale,
      createdAt: row.createdAt,
    })),
    verifications: verificationRows.map((row) => ({
      id: row.id,
      overall: row.overall,
      contentHash: row.contentHash,
      durationMs: row.durationMs,
      createdAt: row.createdAt,
    })),
  };
}
