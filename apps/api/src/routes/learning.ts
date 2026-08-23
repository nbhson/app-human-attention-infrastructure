/**
 * Learning-loop ops route (day-33 §3.4) — a read-only window into recent cycles.
 *
 * `GET /api/learning/cycles` returns the last N `learning.loop_completed` events,
 * reconstructed from the append-only `event_log` (the cycle events are persisted
 * there by the same subscriber that records every bus event). Like `ops.ts`, the
 * database is the dashboard: this endpoint is a thin, read-only projection over
 * `event_log`, never a place to kick the loop or mutate state.
 */

import type { FastifyInstance } from 'fastify';

import { desc, eq } from 'drizzle-orm';

import { eventLog } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { EventType } from '@harness/domain';

/** Default page size for the ops view. */
const DEFAULT_LIMIT = 20;

type LoopCompletedRow = {
  cycle_id: string;
  outcome: string;
  promoted: boolean;
  candidate_proposed: boolean;
  sample_count: number;
  next_since: string | null;
  occurred_at: string;
};

/**
 * The most recent `learning.loop_completed` events, newest first. Each row is the
 * cycle summary: outcome + whether a candidate was promoted, plus the Observe→
 * Evaluate cursor that re-enters the next cycle.
 */
export async function recentLearningCycles(
  db: DrizzleDB,
  limit: number = DEFAULT_LIMIT,
): Promise<readonly LoopCompletedRow[]> {
  const rows = await db
    .select({
      correlation_id: eventLog.correlation_id,
      payload: eventLog.payload,
      occurred_at: eventLog.occurred_at,
    })
    .from(eventLog)
    .where(eq(eventLog.event_type, EventType.LearningLoopCompleted))
    .orderBy(desc(eventLog.occurred_at))
    .limit(limit);

  return rows.map((row) => {
    const payload = row.payload as {
      cycle_id?: string;
      outcome?: string;
      promoted?: boolean;
      candidate_proposed?: boolean;
      sample_count?: number;
      next_since?: string | null;
    };
    return {
      cycle_id: String(row.correlation_id),
      outcome: payload.outcome ?? 'unknown',
      promoted: payload.promoted ?? false,
      candidate_proposed: payload.candidate_proposed ?? false,
      sample_count: payload.sample_count ?? 0,
      next_since: payload.next_since ?? null,
      occurred_at: row.occurred_at.toISOString(),
    };
  });
}

/** Register `GET /api/learning/cycles` over an already-resolved `DrizzleDB`. */
export function registerLearningRoutes(app: FastifyInstance, db: DrizzleDB): void {
  app.get<{ Querystring: { limit?: string } }>('/api/learning/cycles', async (request) => {
    const rawLimit = Number.parseInt(request.query.limit ?? '', 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_LIMIT;
    return { cycles: await recentLearningCycles(db, Math.min(limit, 100)) };
  });
}
