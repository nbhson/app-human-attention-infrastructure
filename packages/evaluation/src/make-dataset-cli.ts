/**
 * `pnpm eval:make-dataset --label feedback|outcome` (day-11 §3.4, §5).
 *
 * Extracts a frozen, hash-sealed calibration dataset from the live store, prints
 * its coverage report (row count + null share + class balance), and persists the
 * `calibration_datasets` / `calibration_rows` rows. Read-only over the source
 * tables; the only writes are the dataset's own `INSERT`s.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';
import { eq, inArray } from 'drizzle-orm';

import {
  agentRuns,
  assessmentFeedback,
  assessments,
  changes,
  createDb,
  decisions,
  taskStateHistory,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import { buildCalibrationRows } from './calibration/extractor.js';
import type {
  AssessmentRecord,
  CalibrationInput,
  CalibrationLabelMode,
  DecisionRecord,
  FeedbackRecord,
} from './calibration/extractor.js';
import { computeCoverage } from './calibration/coverage.js';
import { CalibrationWriter } from './calibration/writer.js';
import type { ReworkRow } from './report.js';

for (const candidate of ['.env', '../../.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) {
    config({ path });
    break;
  }
}

const DEFECT_STATES: readonly string[] = ['REWORK', 'AWAITING_HUMAN_INTERVENTION'];
const DEFAULT_SOURCE_VERSION = 'v0.2.0-harness';
const DEFECT_LAG_HORIZON = 'unbounded';

/** The postgres.js handle `createDb` wraps; drained here so the process exits. */
type ClosableDb = { $client: { end: () => Promise<unknown> } };

function parseLabel(argv: readonly string[]): CalibrationLabelMode {
  for (const arg of argv) {
    if (arg.startsWith('--label=')) {
      const value = arg.slice('--label='.length);
      if (value === 'feedback' || value === 'outcome') return value;
      throw new Error(`--label must be "feedback" or "outcome" (got "${value}")`);
    }
  }
  return 'feedback';
}

/** Read-only load of the four source surfaces, joined to assessment provenance. */
async function loadCalibrationInput(db: DrizzleDB): Promise<CalibrationInput> {
  const [assessmentRows, feedbackRows, decisionRows, reworkRows] = await Promise.all([
    db
      .select({
        assessmentId: assessments.id,
        changeId: assessments.change_id,
        taskId: agentRuns.task_id,
        runId: agentRuns.id,
        risk: assessments.risk_score,
        impact: assessments.impact_score,
        novelty: assessments.novelty_score,
        complexity: assessments.complexity_score,
        confidence: assessments.confidence_score,
        combinedPriority: assessments.combined_priority,
        createdAt: assessments.created_at,
      })
      .from(assessments)
      .innerJoin(changes, eq(changes.id, assessments.change_id))
      .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id)),
    db
      .select({
        assessmentId: assessmentFeedback.assessment_id,
        wasUseful: assessmentFeedback.was_useful,
        createdAt: assessmentFeedback.created_at,
      })
      .from(assessmentFeedback),
    db
      .select({
        assessmentId: decisions.assessment_id,
        decision: decisions.decision,
        createdAt: decisions.created_at,
      })
      .from(decisions),
    db
      .select({
        taskId: taskStateHistory.task_id,
        toState: taskStateHistory.to_state,
        occurredAt: taskStateHistory.occurred_at,
      })
      .from(taskStateHistory)
      .where(inArray(taskStateHistory.to_state, [...DEFECT_STATES])),
  ]);

  const assessmentsOut: AssessmentRecord[] = assessmentRows.map((row) => ({
    assessmentId: row.assessmentId,
    taskId: row.taskId,
    changeId: row.changeId,
    runId: row.runId,
    factors: {
      risk: row.risk,
      impact: row.impact,
      novelty: row.novelty,
      complexity: row.complexity,
      confidence: row.confidence,
    },
    combinedPriority: row.combinedPriority,
    createdAt: row.createdAt,
  }));

  const feedback: FeedbackRecord[] = feedbackRows.map((row) => ({
    assessmentId: row.assessmentId,
    wasUseful: row.wasUseful,
    createdAt: row.createdAt,
  }));

  const decisionRowsOut: DecisionRecord[] = decisionRows.map((row) => ({
    assessmentId: row.assessmentId,
    decision: row.decision,
    createdAt: row.createdAt,
  }));

  const rework: ReworkRow[] = reworkRows.map((row) => ({
    taskId: row.taskId,
    toState: row.toState,
    occurredAt: row.occurredAt,
  }));

  return { assessments: assessmentsOut, feedback, decisions: decisionRowsOut, rework };
}

async function main(): Promise<void> {
  const label = parseLabel(process.argv.slice(2));

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.');
    process.exitCode = 1;
    return;
  }

  const db = createDb(connectionString);
  const sourceVersion =
    process.env.SOURCE_VERSION ?? process.env.EVAL_SOURCE_VERSION ?? DEFAULT_SOURCE_VERSION;

  try {
    const input = await loadCalibrationInput(db);
    const { rows, contentHash } = buildCalibrationRows(input, label);
    const coverage = computeCoverage(rows);

    const dataset = await new CalibrationWriter(db).write(rows, {
      labelSource: label,
      contentHash,
      sourceVersion,
      defectLagHorizon: DEFECT_LAG_HORIZON,
    });

    console.log(
      JSON.stringify(
        {
          dataset: {
            id: dataset.id,
            labelSource: label,
            sourceVersion,
            defectLagHorizon: DEFECT_LAG_HORIZON,
            rowCount: dataset.rowCount,
            contentHash: dataset.contentHash,
          },
          coverage,
        },
        null,
        2,
      ),
    );
  } catch (error: unknown) {
    console.error(`[eval:make-dataset] ${String(error)}`);
    process.exitCode = 1;
  } finally {
    await (db as unknown as ClosableDb).$client.end();
  }
}

void main();
