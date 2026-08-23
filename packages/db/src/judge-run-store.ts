import type { JudgeRun, JudgeRunStore } from '@harness/domain';

import type { DrizzleDB } from './client.js';
import { judgeRuns } from './schema/index.js';

/**
 * The Drizzle implementation of the {@link JudgeRunStore} port (day-21 §2.3).
 *
 * One `judge_runs` row per completed judge run, written by the judge *after* it
 * parses the scores — so a persisted row always carries the full
 * prompt-version/model/temperature/report-hash/scores/reasoning tuple, never a
 * partial write. The row id is the run's own UUID (append-only, never keyed by
 * report or updated); `report_hash` + `temperature` are provenance for day-22's
 * agreement recomputation.
 */
export class DrizzleJudgeRunStore implements JudgeRunStore {
  constructor(private readonly db: DrizzleDB) {}

  async record(run: JudgeRun): Promise<void> {
    await this.db.insert(judgeRuns).values({
      id: run.id,
      report_id: run.reportId,
      prompt_version: run.promptVersion,
      model: run.model,
      temperature: run.temperature ?? null,
      report_hash: run.reportHash,
      severity_agreement: run.scores.severityAgreement,
      routing_agreement: run.scores.routingAgreement,
      evidence_sufficiency: run.scores.evidenceSufficiency,
      overall: run.scores.overall,
      reasoning: run.reasoning,
      // created_at defaults to now() server-side.
    });
  }
}
