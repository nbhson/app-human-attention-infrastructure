import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  agentRuns,
  artifacts,
  assessments,
  changes,
  decisions,
  evidence,
  memoryEntries,
  memoryEntryEvidence,
  projects,
  reviewFindings,
  reviewReports,
  tasks,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import {
  EventType,
  HumanDecisionType,
  MemoryKind,
  ReviewSeverity,
  ReviewVerdict,
  TaskStatus,
  newAgentRunID,
  newArtifactID,
  newAssessmentID,
  newChangeID,
  newCorrelationID,
  newDecisionID,
  newProjectID,
  newReviewFindingID,
  newReviewReportID,
  newReviewerID,
  newTaskID,
  newUserID,
} from '@harness/domain';
import type { ChangeID, DecisionID, MemoryEntry, ReviewReportID, TaskID } from '@harness/domain';
import { createEvent, InProcessEventBus } from '@harness/event-bus';

import { MemoryDistiller, MemoryIngestor, MemoryStore, memoryDedupKey } from '../index.js';

const SCHEMA = 'harness_test_memory_ingestion';

let testDb: TestDb;
let db: DrizzleDB;
let bus: InProcessEventBus;
let store: MemoryStore;
let ingestor: MemoryIngestor;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // Fresh bus + store + ingestor per test, so no subscription double-fires and
  // no cross-test contamination. A fresh `db` isn't needed — the isolated schema
  // is shared, so the tables are cleared instead (children before parents).
  bus = new InProcessEventBus();
  store = new MemoryStore(db, bus);
  ingestor = new MemoryIngestor(db, bus, store);
  ingestor.subscribe();

  await db.delete(memoryEntryEvidence);
  await db.delete(memoryEntries);
  await db.delete(evidence);
  await db.delete(reviewFindings);
  await db.delete(reviewReports);
  await db.delete(decisions);
  await db.delete(assessments);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(tasks);
  await db.delete(projects);
});

/** Poll `listByKind` until `count` entries exist — the ingestor handler is fire-and-forget. */
async function waitForEntries(kind: MemoryEntry['kind'], count: number): Promise<MemoryEntry[]> {
  const deadline = Date.now() + 4_000;
  for (;;) {
    const entries = await store.listByKind(kind);
    if (entries.length >= count) {
      return entries;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${count} ${kind} entries`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Seed a review report (task_id null — the review slice may run without a task) + two findings. */
async function seedReport(): Promise<{ reportId: ReviewReportID; taskId: TaskID }> {
  const reportId = newReviewReportID();
  await db.insert(reviewReports).values({
    id: reportId,
    pr_url: 'https://github.com/acme/api/pull/1',
    pr_number: 1,
    repo: 'acme/api',
    pr_title: 'Add widget endpoint',
    ai_provider: 'openai',
    model: 'gpt-4.1',
    summary: 'Adds the /widget endpoint; the payload dereference needs a guard.',
    overall_verdict: ReviewVerdict.RequestChanges,
    pr_payload: { files: [] },
  });
  await db.insert(reviewFindings).values([
    {
      id: newReviewFindingID(),
      report_id: reportId,
      severity: ReviewSeverity.Major,
      file: 'src/widget.ts',
      message: 'Missing null check on user input',
      suggestion: 'Guard against null before dereferencing',
      order_index: 0,
    },
    {
      id: newReviewFindingID(),
      report_id: reportId,
      severity: ReviewSeverity.Minor,
      file: 'src/widget.ts',
      message: 'Unused import',
      order_index: 1,
    },
  ]);
  return { reportId, taskId: newTaskID() };
}

/** Seed the full FK chain behind a decision row (project → task → run → artifact → change → assessment). */
async function seedDecision(): Promise<{ decisionId: DecisionID; changeId: ChangeID }> {
  const projectId = newProjectID();
  const taskId = newTaskID();
  const runId = newAgentRunID();
  const artifactId = newArtifactID();
  const changeId = newChangeID();
  const assessmentId = newAssessmentID();
  const decisionId = newDecisionID();

  await db.insert(projects).values({ id: projectId, name: 'p', repo_path: '/tmp/p' });
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'Do the thing',
    state: TaskStatus.AwaitingReview,
    idempotency_key: `ik-${taskId}`,
  });
  await db.insert(agentRuns).values({
    id: runId,
    task_id: taskId,
    status: 'COMPLETED',
    max_steps: 10,
  });
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/index.ts',
    status: 'PENDING_REVIEW',
  });
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: runId,
    change_type: 'CREATED',
    status: 'VERIFIED',
    content_hash: 'h',
    diff_summary: 'new file',
  });
  await db.insert(assessments).values({
    id: assessmentId,
    artifact_id: artifactId,
    change_id: changeId,
    risk_score: 0.5,
    impact_score: 0.5,
    novelty_score: 0.5,
    complexity_score: 0.5,
    confidence_score: 0.5,
    combined_priority: 0.6,
    label: 'HIGH',
    factors_unavailable: [],
  });
  await db.insert(decisions).values({
    id: decisionId,
    change_id: changeId,
    assessment_id: assessmentId,
    decision: HumanDecisionType.RequestChanges,
    reviewer_id: newReviewerID(),
    rationale: 'Block the endpoint until the payload is validated before use.',
  });
  return { decisionId, changeId };
}

describe('MemoryDistiller (day-17 §2.1)', () => {
  it('distills a completed review into REVIEW + one FINDING per finding', () => {
    const candidates = new MemoryDistiller().distillReport({
      reportId: 'r1',
      prUrl: 'https://github.com/acme/api/pull/1',
      summary: 'Adds a widget.',
      verdict: ReviewVerdict.RequestChanges,
      findings: [
        {
          findingId: 'f1',
          severity: ReviewSeverity.Major,
          file: 'src/widget.ts',
          message: 'Missing null check',
          suggestion: null,
        },
      ],
    });

    expect(candidates.map((c) => c.kind)).toEqual(['REVIEW', 'FINDING']);

    const review = candidates[0];
    expect(review?.subject).toBe('report:https://github.com/acme/api/pull/1');
    expect(review?.content).toContain('REQUEST_CHANGES');
    expect(review?.confidence).toBe(50); // REVIEW base

    const finding = candidates[1];
    expect(finding?.subject).toBe('finding:MAJOR:missing null check');
    expect(finding?.content).toContain('MAJOR in src/widget.ts');
    expect(finding?.confidence).toBe(70); // MAJOR → 70
  });

  it('distills a decision into one DECISION entry anchored on the change', () => {
    const [decision] = new MemoryDistiller().distillDecision({
      decisionId: 'd1',
      changeId: 'c1',
      decision: HumanDecisionType.RequestChanges,
      rationale: 'validate before use',
    });
    expect(decision?.kind).toBe('DECISION');
    expect(decision?.subject).toBe('decision:c1');
    expect(decision?.content).toContain('REQUEST_CHANGES');
    expect(decision?.confidence).toBe(50);
  });
});

describe('MemoryIngestor (day-17 §2.3 §3.4)', () => {
  it('ingests review.report_created into REVIEW + FINDING entries with evidence links', async () => {
    const { reportId, taskId } = await seedReport();

    bus.publish(
      createEvent(EventType.ReviewReportCreated, newCorrelationID(), {
        task_id: taskId,
        review_report_id: reportId,
        pr_url: 'https://github.com/acme/api/pull/1',
        finding_count: 2,
        suggestion_count: 0,
      }),
    );

    const reviews = await waitForEntries(MemoryKind.REVIEW, 1);
    const findings = await waitForEntries(MemoryKind.FINDING, 2);

    expect(reviews[0]?.content).toContain('https://github.com/acme/api/pull/1');
    expect(reviews[0]?.sourceEvidence.length).toBeGreaterThan(0);
    // Every entry cites ≥1 evidence; the two findings share the one report evidence row.
    const evidenceIds = new Set(findings.flatMap((f) => f.sourceEvidence));
    expect(evidenceIds.size).toBe(1);
  });

  it('ingests review.decision_submitted into a DECISION entry', async () => {
    const { decisionId, changeId } = await seedDecision();

    bus.publish(
      createEvent(EventType.DecisionSubmitted, newCorrelationID(), {
        decision_id: decisionId,
        change_id: changeId,
        decision: HumanDecisionType.RequestChanges,
        reviewer_id: newReviewerID(),
        actor_id: newUserID(),
      }),
    );

    const entries = await waitForEntries(MemoryKind.DECISION, 1);
    expect(entries[0]?.content).toContain('validated before use');
    expect(entries[0]?.metadata.change_id).toBe(changeId);
    expect(entries[0]?.sourceEvidence.length).toBeGreaterThan(0);
  });

  it('re-ingesting the same finding appends a superseding version with bumped confidence', async () => {
    const { reportId, taskId } = await seedReport();

    const publishReport = () =>
      bus.publish(
        createEvent(EventType.ReviewReportCreated, newCorrelationID(), {
          task_id: taskId,
          review_report_id: reportId,
          pr_url: 'https://github.com/acme/api/pull/1',
          finding_count: 2,
          suggestion_count: 0,
        }),
      );

    publishReport();
    await waitForEntries(MemoryKind.FINDING, 2);

    publishReport();
    const findings = await waitForEntries(MemoryKind.FINDING, 4);

    // Only the MAJOR "missing null check" finding recurs with itself — same dedup
    // key (severity + normalized message), so it chains onto the first MAJOR entry.
    const major = findings.filter((f) => f.content.includes('Missing null check'));
    expect(major).toHaveLength(2);
    const [head, base] = major; // listByKind is newest-first
    expect(head?.supersedes).toBe(base?.id);
    expect(head?.confidence).toBe(80); // MAJOR 70 + one recurrence (+10)
    expect(base?.confidence).toBe(70);
    expect(head?.metadata.dedup_key).toBe(base?.metadata.dedup_key);
  });

  it('versioned append keys the same idea by kind|subject', () => {
    expect(memoryDedupKey(MemoryKind.REVIEW, 'report:https://x/p/2')).toBe(
      'REVIEW|report:https://x/p/2',
    );
    expect(memoryDedupKey(MemoryKind.FINDING, 'finding:MAJOR:missing null check')).toBe(
      'FINDING|finding:MAJOR:missing null check',
    );
  });
});
