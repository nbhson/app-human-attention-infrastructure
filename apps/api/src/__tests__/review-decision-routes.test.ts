/**
 * Review-decision route integration test (Phase 3 day-09).
 *
 * Exercises the real `POST /api/reviews/:id/decision` handler against a real
 * Postgres schema, with a fake `WriteBackService` recording every emitted intent.
 * This proves the day-09 acceptance criteria at the HTTP surface:
 *
 *  - APPROVE + ON  → a COMMENT and a STATUS intent are emitted.
 *  - REJECT  + ON  → a COMMENT and a STATUS (failure) intent are emitted.
 *  - any OFF (missing flag or unarmed ceiling) → zero intents, `writeback: false`.
 *  - `WRITEBACK_ENABLED=false` at rest defeats a request-level ON.
 *  - the decision row persists its effective toggle for audit.
 */

import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { Container, TOKENS } from '@harness/di';
import { WritebackAction, newReviewReportID } from '@harness/domain';
import type { WriteBackIntent } from '@harness/domain';
import { reviewDecisions, reviewReports, writebackLog } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import type { WriteBackService } from '@harness/writeback';
import type { ReviewIngestService } from '../services/review-ingest.js';

import { registerReviewIngestRoutes } from '../routes/reviews.js';

const SCHEMA = 'harness_test_review_decision';

let testDb: TestDb;
const reportId = newReviewReportID();

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // FK order: writeback_log → review_decisions → review_reports.
  await testDb.db.delete(writebackLog);
  await testDb.db.delete(reviewDecisions);
  await testDb.db.delete(reviewReports);

  await testDb.db.insert(reviewReports).values({
    id: reportId,
    pr_url: 'https://github.com/acme/api/pull/42',
    pr_number: 42,
    repo: 'github.com/acme/api',
    pr_title: 'Fix the thing',
    ai_provider: 'anthropic',
    model: 'claude-sonnet-4',
    summary: 'Looks good',
    overall_verdict: 'APPROVE',
    pr_payload: {},
  });

  delete process.env.WRITEBACK_ENABLED;
});

afterEach(() => {
  delete process.env.WRITEBACK_ENABLED;
});

interface Harness {
  app: ReturnType<typeof Fastify>;
  intents: WriteBackIntent[];
}

/** Wire the routes over the test DB with a fake write-back service recording intents. */
function build(): Harness {
  const intents: WriteBackIntent[] = [];
  const fakeWriteback: WriteBackService = {
    write: async (intent) => {
      intents.push(intent);
      return { ok: true, intentId: intent.id };
    },
  };

  const container = new Container();
  container.register(TOKENS.Db, () => testDb.db);
  container.register(TOKENS.WriteBackService, () => fakeWriteback);
  container.register(TOKENS.ReviewIngestService, () => ({}) as ReviewIngestService);

  const app = Fastify({ logger: false });
  registerReviewIngestRoutes(app, container);
  return { app, intents };
}

async function decisionRows() {
  return testDb.db.select().from(reviewDecisions).where(eq(reviewDecisions.report_id, reportId));
}

describe('POST /api/reviews/:id/decision (day-09 write-back toggle)', () => {
  it('OFF (missing flag, at rest) records writeback:false and emits nothing', async () => {
    const { app, intents } = build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      payload: { decision: 'APPROVE', rationale: 'LGTM' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { writeback: false };
    expect(body.writeback).toBe(false);
    expect(intents).toHaveLength(0);

    const rows = await decisionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decision: 'APPROVE', writeback_enabled: false });

    await app.close();
  });

  it('ON + APPROVE emits COMMENT + STATUS(success) and records writeback:true', async () => {
    process.env.WRITEBACK_ENABLED = '1';
    const { app, intents } = build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      payload: { decision: 'APPROVE', rationale: 'LGTM', writeback: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      decisionId: string;
      writeback: { comment: { ok: boolean }; status: { ok: boolean } };
    };
    expect(body.writeback.comment.ok).toBe(true);
    expect(body.writeback.status.ok).toBe(true);

    expect(intents).toHaveLength(2);
    expect(intents.map((i) => i.action)).toEqual([WritebackAction.Comment, WritebackAction.Status]);
    expect(intents[0]?.state).toBeUndefined();
    expect(intents[1]?.state).toBe('success');
    expect(intents[0]?.decisionId).toBe(body.decisionId);
    expect(intents[1]?.decisionId).toBe(body.decisionId);

    const rows = await decisionRows();
    expect(rows[0]).toMatchObject({ decision: 'APPROVE', writeback_enabled: true });

    await app.close();
  });

  it('WRITEBACK_ENABLED=false at rest defeats a request-level ON', async () => {
    // No WRITEBACK_ENABLED → ceiling OFF, even though the request asks for ON.
    const { app, intents } = build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      payload: { decision: 'APPROVE', writeback: true },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { writeback: false }).writeback).toBe(false);
    expect(intents).toHaveLength(0);

    const rows = await decisionRows();
    expect(rows[0]).toMatchObject({ writeback_enabled: false });

    await app.close();
  });

  it('ON + REJECT emits COMMENT + STATUS(failure)', async () => {
    process.env.WRITEBACK_ENABLED = '1';
    const { app, intents } = build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      payload: { decision: 'REJECT', rationale: 'breaks CI', writeback: true },
    });

    expect(res.statusCode).toBe(200);
    expect(intents).toHaveLength(2);
    expect(intents[1]?.action).toBe(WritebackAction.Status);
    expect(intents[1]?.state).toBe('failure');

    await app.close();
  });

  it('ON + REQUEST_CHANGES emits nothing external', async () => {
    process.env.WRITEBACK_ENABLED = '1';
    const { app, intents } = build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      payload: { decision: 'REQUEST_CHANGES', writeback: true },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { writeback: { emitted: number } }).writeback.emitted).toBe(0);
    expect(intents).toHaveLength(0);

    // The toggle is still recorded (ON, but REQUEST_CHANGES never writes).
    const rows = await decisionRows();
    expect(rows[0]).toMatchObject({ decision: 'REQUEST_CHANGES', writeback_enabled: true });

    await app.close();
  });

  it('rejects an unknown decision with 400 and writes no row', async () => {
    const { app, intents } = build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      payload: { decision: 'WHATEVER' },
    });

    expect(res.statusCode).toBe(400);
    expect(intents).toHaveLength(0);
    expect(await decisionRows()).toHaveLength(0);

    await app.close();
  });
});
