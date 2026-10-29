/**
 * Minimal ops endpoints (day-27 §2.4) — no dashboard UI; the database is the
 * dashboard. `GET /api/ops/health` proves the DB is reachable; `GET /api/ops/metrics`
 * returns the two gauges an operator eyeballs first: the task-state distribution,
 * the review-queue depth, and the orphan-alarm count (§2.3 Q8).
 *
 * Deliberately absent: Prometheus exporters, Grafana, log aggregation. Phase 1 runs
 * on one machine with `docker compose logs` and `psql`.
 */

import type { FastifyInstance } from 'fastify';

import { and, count, eq, inArray, lt } from 'drizzle-orm';

import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { reviewQueue, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { ReviewQueueStatus, Role, TaskStatus } from '@harness/domain';

/** Orphan-alarm window (day-27 §2.3 Q8): EXECUTING/VERIFYING past this long is stuck. */
const ORPHAN_WINDOW_MS = 10 * 60_000;

/**
 * Count tasks stuck in an in-flight state longer than `olderThanMs`. This is a
 * smoke alarm, not a fixer — when it returns > 0 a human investigates; never
 * auto-"repair" the rows (day-27 §6).
 */
export async function orphanedTaskCount(db: DrizzleDB, olderThanMs = ORPHAN_WINDOW_MS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  // SQL COUNT, not select-then-rows.length: the orphan window can be long and
  // a stuck queue can hold thousands of rows — counting server-side keeps the
  // metrics endpoint O(1) in payload.
  const rows = await db
    .select({ n: count() })
    .from(tasks)
    .where(and(inArray(tasks.state, [TaskStatus.Executing, TaskStatus.Verifying]), lt(tasks.updated_at, cutoff)));
  return rows[0]?.n ?? 0;
}

/** Register the `/api/ops/*` endpoints over the already-wired container. */
export function registerOpsRoutes(app: FastifyInstance, container: Container): void {
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  // `/api/ops/health` chủ đích để MỞ (liveness probe của LB/container không
  // có credential) — chỉ trả `{ok, now}`, không lộ dữ liệu.
  app.get('/api/ops/health', async () => {
    // A single cheap probe proves the connection is live; failure throws → 500.
    await db.select({ id: tasks.id }).from(tasks).limit(1);
    return { ok: true, now: new Date().toISOString() };
  });

  // `/api/ops/ready` là READINESS (khác liveness): process sống nhưng DB chưa
  // reachable thì LB/orchestrator phải ngừng route traffic → trả 503 thay vì
  // crash. Vẫn mở như health — chỉ trả boolean checks, không lộ dữ liệu.
  app.get('/api/ops/ready', async (_request, reply) => {
    const checks: { db: boolean } = { db: false };
    try {
      await db.select({ id: tasks.id }).from(tasks).limit(1);
      checks.db = true;
    } catch {
      // Deliberately no rethrow: readiness reports component state (503) so
      // the orchestrator drains this instance, it doesn't restart it.
      return reply.code(503).send({ ok: false, checks, now: new Date().toISOString() });
    }
    return { ok: true, checks, now: new Date().toISOString() };
  });

  // `/api/ops/metrics` là dữ liệu vận hành nội bộ (task-state distribution,
  // queue depth) — guard OPERATOR trở lên, không public như health.
  const canView = requireRole(container, Role.Operate);

  app.get('/api/ops/metrics', { preHandler: canView }, async () => {
    const [byState, queueRows] = await Promise.all([
      db.select({ state: tasks.state, n: count() }).from(tasks).groupBy(tasks.state),
      db.select({ n: count() }).from(reviewQueue).where(eq(reviewQueue.status, ReviewQueueStatus.Queued)),
    ]);
    return {
      tasksByState: Object.fromEntries(byState.map((row) => [row.state, row.n])),
      reviewQueueDepth: queueRows[0]?.n ?? 0,
      orphanedTasks: await orphanedTaskCount(db),
    };
  });
}
