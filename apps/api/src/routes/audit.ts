/**
 * Global audit HTTP route (day-34 §4.5) — a read-only, paginated timeline over
 * the whole system's append-only trails (events + LLM calls + tool calls + agent
 * runs), normalised by `audit.ts` into one shape.
 *
 * Deliberately coarse: it is an operator/support surface, not a hot path. Each
 * source is queried with the same `limit` + `before` cursor, merged newest-first,
 * and sliced — exact across sources for the common "show me the latest N" case.
 */

import type { FastifyInstance } from 'fastify';

import { and, desc, eq, lt } from 'drizzle-orm';

import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { agentRuns, eventLog, llmCallLog, trajectorySteps, users } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { Role } from '@harness/domain';

import {
  mergeEntries,
  toEventEntry,
  toLlmEntry,
  toRunEntry,
  toToolEntry,
  type AuditEntry,
  type AuditKind,
} from '../audit.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const KINDS: ReadonlySet<string> = new Set<AuditKind>(['event', 'llm', 'tool', 'run']);

interface AuditQuery {
  readonly limit?: string;
  readonly before?: string;
  readonly kind?: string;
  readonly eventType?: string;
  readonly correlationId?: string;
}

/** A single source's fetched page, before cross-source merge. */
interface SourcePage {
  readonly kind: AuditKind;
  readonly entries: readonly AuditEntry[];
  /** The oldest `occurredAt` in this page, or null if it did not fill `limit`. */
  readonly oldest: Date | null;
}

/** Register `GET /api/audit`. */
export function registerAuditRoutes(app: FastifyInstance, container: Container): void {
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const canRead = requireRole(container, Role.Operate, Role.Reviewer, Role.Admin);

  app.get<{ Querystring: AuditQuery }>(
    '/api/audit',
    { preHandler: canRead },
    async (request, reply) => {
      const limit = clampLimit(request.query.limit);
      const before = parseBefore(request.query.before);
      if (before === null) {
        return reply.code(400).send({ error: 'before must be an ISO-8601 timestamp' });
      }
      const kindFilter = request.query.kind;
      if (kindFilter !== undefined && !KINDS.has(kindFilter)) {
        return reply.code(400).send({
          error: `kind must be one of: ${[...KINDS].join(', ')}`,
        });
      }

      const correlationId = nonEmpty(request.query.correlationId);
      const eventType = nonEmpty(request.query.eventType);

      const pages: SourcePage[] = [];
      if (kindFilter === undefined || kindFilter === 'event') {
        pages.push(
          await loadEvents(db, {
            limit,
            before,
            ...(eventType !== undefined ? { eventType } : {}),
            ...(correlationId !== undefined ? { correlationId } : {}),
          }),
        );
      }
      if (kindFilter === undefined || kindFilter === 'llm') {
        pages.push(
          await loadLlm(db, {
            limit,
            before,
            ...(correlationId !== undefined ? { correlationId } : {}),
          }),
        );
      }
      if (kindFilter === undefined || kindFilter === 'tool') {
        pages.push(
          await loadTools(db, {
            limit,
            before,
            ...(correlationId !== undefined ? { correlationId } : {}),
          }),
        );
      }
      if (kindFilter === undefined || kindFilter === 'run') {
        pages.push(
          await loadRuns(db, {
            limit,
            before,
            ...(correlationId !== undefined ? { correlationId } : {}),
          }),
        );
      }

      const entries = mergeEntries(
        pages.map((page) => page.entries),
        limit,
      );

      // The next cursor is the oldest timestamp among pages that actually filled
      // their limit — a short page is the tail of that source, so it cannot carry
      // the cursor forward past the other sources' oldest rows.
      const fullPages = pages.filter((page) => page.entries.length >= limit);
      const oldestCursor =
        fullPages.length === 0
          ? undefined
          : fullPages
              .map((page) => page.oldest as Date)
              .sort((a, b) => a.getTime() - b.getTime())[0];

      return {
        items: entries,
        nextBefore: oldestCursor?.toISOString() ?? null,
      };
    },
  );
}

function clampLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function parseBefore(raw: string | undefined): Date | null {
  if (raw === undefined || raw.length === 0) {
    return new Date(Date.now());
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function nonEmpty(raw: string | undefined): string | undefined {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
}

interface SourceFilter {
  readonly limit: number;
  readonly before: Date;
  readonly eventType?: string;
  readonly correlationId?: string;
}

async function loadEvents(db: DrizzleDB, filter: SourceFilter): Promise<SourcePage> {
  const conditions = [lt(eventLog.occurred_at, filter.before)];
  if (filter.eventType !== undefined) {
    conditions.push(eq(eventLog.event_type, filter.eventType));
  }
  if (filter.correlationId !== undefined) {
    conditions.push(eq(eventLog.correlation_id, filter.correlationId));
  }
  const rows = await db
    .select({
      event_id: eventLog.event_id,
      event_type: eventLog.event_type,
      event_version: eventLog.event_version,
      occurred_at: eventLog.occurred_at,
      correlation_id: eventLog.correlation_id,
      actor_id: eventLog.actor_id,
      actor_name: users.display_name,
      payload: eventLog.payload,
    })
    .from(eventLog)
    .leftJoin(users, eq(eventLog.actor_id, users.id))
    .where(and(...conditions))
    .orderBy(desc(eventLog.occurred_at))
    .limit(filter.limit);
  return {
    kind: 'event',
    entries: rows.map((row) =>
      toEventEntry({ ...row, payload: row.payload as Record<string, unknown> }),
    ),
    oldest: last(rows)?.occurred_at ?? null,
  };
}

async function loadLlm(db: DrizzleDB, filter: SourceFilter): Promise<SourcePage> {
  const conditions = [lt(llmCallLog.created_at, filter.before)];
  if (filter.correlationId !== undefined) {
    conditions.push(eq(llmCallLog.correlation_id, filter.correlationId));
  }
  const rows = await db
    .select()
    .from(llmCallLog)
    .where(and(...conditions))
    .orderBy(desc(llmCallLog.created_at))
    .limit(filter.limit);
  return {
    kind: 'llm',
    entries: rows.map(toLlmEntry),
    oldest: last(rows)?.created_at ?? null,
  };
}

async function loadTools(db: DrizzleDB, filter: SourceFilter): Promise<SourcePage> {
  const conditions = [lt(trajectorySteps.created_at, filter.before)];
  if (filter.correlationId !== undefined) {
    conditions.push(eq(agentRuns.correlation_id, filter.correlationId));
  }
  const rows = await db
    .select({
      id: trajectorySteps.id,
      correlation_id: agentRuns.correlation_id,
      step_number: trajectorySteps.step_number,
      thought: trajectorySteps.thought,
      tool_name: trajectorySteps.tool_name,
      tool_input: trajectorySteps.tool_input,
      observation: trajectorySteps.observation,
      created_at: trajectorySteps.created_at,
    })
    .from(trajectorySteps)
    .leftJoin(agentRuns, eq(trajectorySteps.agent_run_id, agentRuns.id))
    .where(and(...conditions))
    .orderBy(desc(trajectorySteps.created_at))
    .limit(filter.limit);
  return {
    kind: 'tool',
    entries: rows.map(toToolEntry),
    oldest: last(rows)?.created_at ?? null,
  };
}

async function loadRuns(db: DrizzleDB, filter: SourceFilter): Promise<SourcePage> {
  const conditions = [lt(agentRuns.started_at, filter.before)];
  if (filter.correlationId !== undefined) {
    conditions.push(eq(agentRuns.correlation_id, filter.correlationId));
  }
  const rows = await db
    .select()
    .from(agentRuns)
    .where(and(...conditions))
    .orderBy(desc(agentRuns.started_at))
    .limit(filter.limit);
  return {
    kind: 'run',
    entries: rows.map(toRunEntry),
    oldest: last(rows)?.started_at ?? null,
  };
}

function last<T>(rows: readonly T[]): T | undefined {
  return rows.length > 0 ? rows[rows.length - 1] : undefined;
}
