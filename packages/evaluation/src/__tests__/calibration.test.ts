/**
 * Calibration extractor / coverage / hash / writer tests (day-11 §3.5).
 *
 * The extractor and coverage are pure, so the known-answer, null-handling, and
 * hash-determinism tests run without a DB. The writer round-trip runs against an
 * isolated Postgres schema (the calibration tables FK only to each other, so it
 * needs the migration, not the full assessment/feedback/decision graph).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';
import { calibrationDatasets, calibrationRows } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { buildCalibrationRows, deriveOutcome, hashRows } from '../calibration/extractor.js';
import type {
  AssessmentRecord,
  CalibrationInput,
  CalibrationRow,
  DecisionRecord,
  FeedbackRecord,
} from '../calibration/extractor.js';
import { computeCoverage } from '../calibration/coverage.js';
import { CalibrationWriter } from '../calibration/writer.js';
import type { ReworkRow } from '../report.js';

function assessment(over: Partial<AssessmentRecord> & { assessmentId: string }): AssessmentRecord {
  return {
    taskId: 't-1',
    changeId: 'c-1',
    runId: 'r-1',
    factors: { risk: 0.8, impact: 0.7, novelty: 0.6, complexity: 0.5, confidence: 0.9 },
    combinedPriority: 0.7,
    createdAt: new Date('2026-08-20T10:00:00.000Z'),
    ...over,
  };
}

function feedback(assessmentId: string, wasUseful: boolean): FeedbackRecord {
  return { assessmentId, wasUseful, createdAt: new Date('2026-08-20T10:05:00.000Z') };
}

function decision(assessmentId: string, value: string): DecisionRecord {
  return { assessmentId, decision: value, createdAt: new Date('2026-08-20T10:05:00.000Z') };
}

describe('deriveOutcome', () => {
  it.each([
    [null, false, 'APPROVED'],
    [null, true, 'DEFECTED_LATER'],
    ['APPROVED', false, 'APPROVED'],
    ['APPROVED', true, 'DEFECTED_LATER'],
    ['REJECTED', false, 'REJECTED'],
    ['REJECTED', true, 'REJECTED'], // rejection wins over the expected rework
    ['REQUEST_CHANGES', false, 'REJECTED'],
    ['OVERRIDDEN', false, 'REWORKED'],
    ['ESCALATED', true, 'DEFECTED_LATER'],
  ] as const)('decision=%s laterDefect=%s → %s', (decision, laterDefect, expected) => {
    expect(deriveOutcome(decision, laterDefect)).toBe(expected);
  });
});

describe('buildCalibrationRows', () => {
  it('hand-computes the known-answer join: 2 assessments, one with feedback', () => {
    const input: CalibrationInput = {
      assessments: [
        assessment({ assessmentId: 'a-1' }),
        assessment({ assessmentId: 'b-1', taskId: 't-2', changeId: 'c-2', runId: 'r-2' }),
      ],
      feedback: [feedback('a-1', true)],
      decisions: [decision('a-1', 'APPROVED'), decision('b-1', 'REJECTED')],
      rework: [],
    };

    const { rows } = buildCalibrationRows(input, 'feedback');

    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.assessmentId === 'a-1');
    const b = rows.find((r) => r.assessmentId === 'b-1');

    expect(a?.wasUseful).toBe(true);
    expect(a?.outcome).toBe('APPROVED');
    expect(a?.labelSource).toBe('feedback');

    expect(b?.wasUseful).toBe(null);
    expect(b?.outcome).toBe('REJECTED');
    expect(b?.labelSource).toBe('outcome'); // missing feedback → fall back to outcome
  });

  it('retains was_useful-null rows and labels them outcome (never drops, never imputes)', () => {
    const input: CalibrationInput = {
      assessments: [assessment({ assessmentId: 'a-1' })],
      feedback: [], // no feedback at all
      decisions: [decision('a-1', 'APPROVED')],
      rework: [],
    };

    const { rows } = buildCalibrationRows(input, 'feedback');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.wasUseful).toBe(null);
    expect(rows[0]?.labelSource).toBe('outcome');

    const coverage = computeCoverage(rows);
    expect(coverage.withNullFeedback).toBe(1);
    expect(coverage.total).toBe(1);
  });

  it('marks a fly-through that later reworked as DEFECTED_LATER', () => {
    const rework: ReworkRow[] = [
      { taskId: 't-1', toState: 'REWORK', occurredAt: new Date('2026-08-20T11:00:00.000Z') },
    ];
    const input: CalibrationInput = {
      assessments: [assessment({ assessmentId: 'a-1' })],
      feedback: [],
      decisions: [], // no decision → fly-through
      rework,
    };

    const { rows } = buildCalibrationRows(input, 'outcome');
    expect(rows[0]?.outcome).toBe('DEFECTED_LATER');
    expect(rows[0]?.labelSource).toBe('outcome');
  });

  it('in outcome mode, every row labels from the objective outcome', () => {
    const input: CalibrationInput = {
      assessments: [assessment({ assessmentId: 'a-1' })],
      feedback: [feedback('a-1', true)], // has feedback, but mode chooses outcome
      decisions: [decision('a-1', 'APPROVED')],
      rework: [],
    };

    const { rows } = buildCalibrationRows(input, 'outcome');
    expect(rows[0]?.labelSource).toBe('outcome');
    expect(rows[0]?.wasUseful).toBe(true); // still carried, not discarded
  });
});

describe('hashRows', () => {
  const input: CalibrationInput = {
    assessments: [
      assessment({ assessmentId: 'a-1' }),
      assessment({ assessmentId: 'b-1', taskId: 't-2', changeId: 'c-2', runId: 'r-2' }),
    ],
    feedback: [feedback('a-1', true)],
    decisions: [decision('a-1', 'APPROVED'), decision('b-1', 'REJECTED')],
    rework: [],
  };

  it('is deterministic across two extractions of the unchanged store', () => {
    const first = buildCalibrationRows(input, 'feedback');
    const second = buildCalibrationRows(input, 'feedback');
    expect(first.contentHash).toBe(second.contentHash);
  });

  it('changes when one row is tampered', () => {
    const { rows } = buildCalibrationRows(input, 'feedback');
    const original = hashRows(rows);
    const tampered: CalibrationRow[] = rows.map((r) => (r.assessmentId === 'b-1' ? { ...r, outcome: 'APPROVED' } : r));
    expect(hashRows(tampered)).not.toBe(original);
  });
});

describe('computeCoverage', () => {
  it('reports null share and emits a governance note past the threshold', () => {
    const rows: CalibrationRow[] = [
      {
        assessmentId: 'a-1',
        taskId: 't-1',
        changeId: 'c-1',
        runId: 'r-1',
        factorScores: { risk: 0.1, impact: 0.1, novelty: 0.1, complexity: 0.1, confidence: 0.1 },
        combinedPriority: 0.1,
        wasUseful: true,
        outcome: 'APPROVED',
        labelSource: 'feedback',
      },
      {
        assessmentId: 'b-1',
        taskId: 't-2',
        changeId: 'c-2',
        runId: 'r-2',
        factorScores: { risk: 0.1, impact: 0.1, novelty: 0.1, complexity: 0.1, confidence: 0.1 },
        combinedPriority: 0.1,
        wasUseful: null,
        outcome: 'REJECTED',
        labelSource: 'outcome',
      },
      {
        assessmentId: 'c-1',
        taskId: 't-3',
        changeId: 'c-3',
        runId: 'r-3',
        factorScores: { risk: 0.1, impact: 0.1, novelty: 0.1, complexity: 0.1, confidence: 0.1 },
        combinedPriority: 0.1,
        wasUseful: null,
        outcome: 'DEFECTED_LATER',
        labelSource: 'outcome',
      },
    ];

    const coverage = computeCoverage(rows);
    expect(coverage.total).toBe(3);
    expect(coverage.withNullFeedback).toBe(2);
    expect(coverage.nullShare).toBeCloseTo(2 / 3);
    expect(coverage.byOutcome).toMatchObject({ APPROVED: 1, REJECTED: 1, DEFECTED_LATER: 1 });
    expect(coverage.governanceNote).toBeDefined(); // 66% > 40% threshold
  });
});

describe('CalibrationWriter', () => {
  const SCHEMA = 'harness_test_calibration';
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb(SCHEMA);
  });

  afterAll(async () => {
    await destroyTestDb(testDb, SCHEMA);
  });

  it('persists a sealed dataset and reads its rows back intact', async () => {
    const rows: CalibrationRow[] = [
      {
        assessmentId: 'a-1',
        taskId: 't-1',
        changeId: 'c-1',
        runId: 'r-1',
        factorScores: { risk: 0.8, impact: 0.7, novelty: 0.6, complexity: 0.5, confidence: 0.9 },
        combinedPriority: 0.7,
        wasUseful: true,
        outcome: 'APPROVED',
        labelSource: 'feedback',
      },
    ];
    const contentHash = hashRows(rows);

    const writer = new CalibrationWriter(testDb.db);
    const dataset = await writer.write(rows, {
      labelSource: 'feedback',
      contentHash,
      sourceVersion: 'v0.2.0-harness',
      defectLagHorizon: 'unbounded',
    });

    expect(dataset.rowCount).toBe(1);
    expect(dataset.contentHash).toBe(contentHash);

    const storedRows = await testDb.db.select().from(calibrationRows).where(eq(calibrationRows.dataset_id, dataset.id));
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]?.assessment_id).toBe('a-1');
    expect(storedRows[0]?.outcome).toBe('APPROVED');
    expect(storedRows[0]?.was_useful).toBe(true);

    const storedDatasets = await testDb.db
      .select()
      .from(calibrationDatasets)
      .where(eq(calibrationDatasets.id, dataset.id));
    expect(storedDatasets).toHaveLength(1);
    expect(storedDatasets[0]?.source_version).toBe('v0.2.0-harness');
    expect(storedDatasets[0]?.label_source).toBe('feedback');
    expect(storedDatasets[0]?.row_count).toBe(1);
    expect(storedDatasets[0]?.content_hash).toBe(contentHash);
  });
});
