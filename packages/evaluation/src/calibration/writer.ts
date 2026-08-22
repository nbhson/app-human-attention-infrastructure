/**
 * Calibration persistence (day-11 §3.4).
 *
 * The writer has exactly one mutating method — `write` — and it only ever
 * `INSERT`s. The dataset is sealed by its `content_hash` and `source_version`
 * at write time; there is no UPDATE/DELETE path, so a published fit set cannot
 * be edited in place (a corrected extraction is a *new* dataset version).
 */

import { calibrationDatasets, calibrationRows } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { uuidv7 } from '@harness/domain';

import type { CalibrationRow } from './extractor.js';

export interface SealedDataset {
  readonly id: string;
  readonly contentHash: string;
  readonly rowCount: number;
}

export interface DatasetMetadata {
  /** The `--label` mode this dataset was extracted for (`feedback` | `outcome`). */
  readonly labelSource: string;
  /** The pre-computed SHA-256 over the ordered row set. */
  readonly contentHash: string;
  /** The code that produced the extraction. */
  readonly sourceVersion: string;
  /** DEFECTED_LATER lag horizon (day-11 §6). */
  readonly defectLagHorizon: string;
}

export class CalibrationWriter {
  constructor(private readonly db: DrizzleDB) {}

  /** Insert the dataset header + all rows in one call. Append-only. */
  async write(rows: readonly CalibrationRow[], meta: DatasetMetadata): Promise<SealedDataset> {
    const id = uuidv7();
    await this.db.insert(calibrationDatasets).values({
      id,
      label_source: meta.labelSource,
      row_count: rows.length,
      content_hash: meta.contentHash,
      source_version: meta.sourceVersion,
      defect_lag_horizon: meta.defectLagHorizon,
    });

    if (rows.length > 0) {
      await this.db.insert(calibrationRows).values(
        rows.map((row) => ({
          dataset_id: id,
          assessment_id: row.assessmentId,
          task_id: row.taskId,
          change_id: row.changeId,
          run_id: row.runId,
          factor_scores: row.factorScores,
          combined_priority: row.combinedPriority,
          was_useful: row.wasUseful,
          outcome: row.outcome,
          label_source: row.labelSource,
        })),
      );
    }

    return { id, contentHash: meta.contentHash, rowCount: rows.length };
  }
}
