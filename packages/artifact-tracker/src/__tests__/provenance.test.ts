import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { uuidv7 } from '@harness/domain';
import {
  agentRuns,
  evidence,
  evidenceLinks,
  eventLog,
  llmCallLog,
  trajectorySteps,
  verificationCheckResults,
  verificationReports,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { buildProvenanceChain } from '../provenance.js';
import { insertChange, seedRun } from './helpers.js';

const SCHEMA = 'harness_test_provenance';

let testDb: TestDb;
let db: DrizzleDB;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

describe('buildProvenanceChain', () => {
  it('populates all seven sections for an end-to-end seeded task', async () => {
    const seed = await seedRun(db, 'provenance');
    const { artifactId, changeId } = await insertChange(db, seed);

    // llm calls + trajectory tied to the task's run.
    await db.insert(llmCallLog).values({
      id: uuidv7(),
      agent_run_id: seed.runId,
      model: 'claude-sonnet-5',
      input_tokens: 10,
      output_tokens: 20,
      stop_reason: 'end_turn',
      request_hash: 'req-hash',
    });
    await db.insert(trajectorySteps).values({
      id: uuidv7(),
      agent_run_id: seed.runId,
      step_number: 1,
      thought: 'reasoning',
      tool_name: 'write_file',
    });

    // verification report + check result + evidence (linked via evidence_links).
    const evidenceId = uuidv7();
    await db.insert(evidence).values({
      id: evidenceId,
      content_hash: 'proof-hash',
      kind: 'CHECK_OUTPUT',
      body: 'tsc: 0 errors',
    });
    const reportId = uuidv7();
    await db.insert(verificationReports).values({
      id: reportId,
      change_id: changeId,
      task_id: seed.taskId,
      overall: 'PASSED',
      duration_ms: 100,
      flaky: false,
    });
    const checkResultId = uuidv7();
    await db.insert(verificationCheckResults).values({
      id: checkResultId,
      report_id: reportId,
      check_kind: 'COMPILE',
      status: 'PASSED',
      duration_ms: 100,
      output: 'ok',
      evidence_id: evidenceId,
    });
    await db.insert(evidenceLinks).values({
      id: uuidv7(),
      evidence_id: evidenceId,
      subject_kind: 'check_result',
      subject_id: checkResultId,
    });

    // events across the three correlation channels the task's trail uses.
    await db.insert(eventLog).values({
      event_id: uuidv7(),
      event_type: 'TaskStateChanged',
      event_version: 1,
      occurred_at: new Date('2026-01-01T00:00:00Z'),
      correlation_id: seed.taskId,
      payload: { state: 'EXECUTING' },
    });
    await db.insert(eventLog).values({
      event_id: uuidv7(),
      event_type: 'ArtifactCreated',
      event_version: 1,
      occurred_at: new Date('2026-01-02T00:00:00Z'),
      correlation_id: seed.runId,
      payload: { artifactId },
    });
    await db.insert(eventLog).values({
      event_id: uuidv7(),
      event_type: 'VerificationCompleted',
      event_version: 1,
      occurred_at: new Date('2026-01-03T00:00:00Z'),
      correlation_id: changeId,
      payload: { overall: 'PASSED' },
    });

    const chain = await buildProvenanceChain(db, seed.taskId);

    // 1. task
    expect(chain.task).toMatchObject({ id: seed.taskId });

    // 2. agentRun
    expect(chain.agentRun).toMatchObject({ id: seed.runId });

    // 3. llmCalls
    expect(chain.llmCalls).toHaveLength(1);
    expect(chain.llmCalls[0]).toMatchObject({ model: 'claude-sonnet-5' });

    // 4. trajectory
    expect(chain.trajectory).toHaveLength(1);
    expect(chain.trajectory[0]).toMatchObject({ stepNumber: 1, toolName: 'write_file' });

    // 5. artifacts
    expect(chain.artifacts).toHaveLength(1);
    expect(chain.artifacts[0]).toMatchObject({ id: artifactId, contentHash: 'seed-hash' });

    // 6. verification
    expect(chain.verification.reports).toHaveLength(1);
    expect(chain.verification.reports[0]).toMatchObject({ id: reportId, overall: 'PASSED' });
    expect(chain.verification.checkResults).toHaveLength(1);
    expect(chain.verification.checkResults[0]).toMatchObject({
      id: checkResultId,
      checkKind: 'COMPILE',
    });
    expect(chain.verification.evidenceIds).toEqual([evidenceId]);

    // 7. events
    expect(chain.events).toHaveLength(3);
    expect(chain.events.map((event) => event.eventType).sort()).toEqual([
      'ArtifactCreated',
      'TaskStateChanged',
      'VerificationCompleted',
    ]);
  });

  it('returns only the task section for a task with no runs', async () => {
    const seed = await seedRun(db, 'provenance-empty');
    // remove the auto-seeded run so the task has none.
    await db.delete(agentRuns).where(eq(agentRuns.task_id, seed.taskId));

    const chain = await buildProvenanceChain(db, seed.taskId);

    expect(chain.task).not.toBeNull();
    expect(chain.agentRun).toBeNull();
    expect(chain.llmCalls).toEqual([]);
    expect(chain.trajectory).toEqual([]);
    expect(chain.artifacts).toEqual([]);
    expect(chain.verification.reports).toEqual([]);
    expect(chain.events).toEqual([]);
  });
});
