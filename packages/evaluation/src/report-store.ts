/**
 * Append-only report persistence (day-07 §2.3, §3.2).
 *
 * The repository exposes exactly two methods — `insert` and `listByWindow` — and
 * **no mutating methods**. A published report is evidence about the pipeline and
 * follows the same immutability rule as `evidence` and `snapshots`: a mistaken
 * report is superseded by a *new* row, never edited in place (day-07 §6). The
 * `evaluation_reports` UNIQUE index on `(window_from, window_to, source_version)`
 * makes re-running the same window under the same code a constraint violation
 * rather than a silent duplicate.
 */

import { and, gte, lte } from 'drizzle-orm';

import { evaluationReports } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { uuidv7 } from '@harness/domain';

import type { EvaluationReport } from './report.js';

/** A raw report row as read out of the store, with its JSON document parsed. */
export interface StoredReport {
  readonly id: string;
  readonly windowFrom: Date;
  readonly windowTo: Date;
  readonly generatedAt: Date;
  readonly report: EvaluationReport;
  readonly sourceVersion: string;
}

export class ReportStore {
  constructor(private readonly db: DrizzleDB) {}

  /**
   * Persist one window's report under a fresh UUIDv7. Returns the new row id.
   * A duplicate `(window_from, window_to, source_version)` violates the DB
   * UNIQUE constraint and rejects rather than duplicating a historical number.
   */
  async insert(report: EvaluationReport, sourceVersion: string): Promise<string> {
    const id = uuidv7();
    await this.db.insert(evaluationReports).values({
      id,
      window_from: new Date(report.window.from),
      window_to: new Date(report.window.to),
      generated_at: new Date(report.generatedAt),
      report,
      source_version: sourceVersion,
    });
    return id;
  }

  /** List reports whose window overlaps `[from, to]`, ascending by window start. */
  async listByWindow(from: Date, to: Date): Promise<StoredReport[]> {
    const rows = await this.db
      .select()
      .from(evaluationReports)
      .where(and(gte(evaluationReports.window_from, from), lte(evaluationReports.window_to, to)))
      .orderBy(evaluationReports.window_from);
    return rows.map((row) => ({
      id: row.id,
      windowFrom: row.window_from,
      windowTo: row.window_to,
      generatedAt: row.generated_at,
      report: row.report as unknown as EvaluationReport,
      sourceVersion: row.source_version,
    }));
  }
}
