import { newJudgeAgreementID } from '@harness/domain';
import type { JudgeAgreementRecord, JudgeAgreementStore } from '@harness/domain';

import type { DrizzleDB } from './client.js';
import { judgeAgreements } from './schema/index.js';

/**
 * The Drizzle implementation of the {@link JudgeAgreementStore} port (day-22 §2.4).
 *
 * One `judge_agreements` row per computed inter-judge agreement, carrying the
 * run ids + report hashes the number was computed from so it can be recomputed
 * from `judge_runs`. Append-only — the row id is a fresh UUID and rows are never
 * updated.
 */
export class DrizzleJudgeAgreementStore implements JudgeAgreementStore {
  constructor(private readonly db: DrizzleDB) {}

  async record(agreement: JudgeAgreementRecord): Promise<void> {
    await this.db.insert(judgeAgreements).values({
      id: newJudgeAgreementID(),
      run_a_ids: [...agreement.aRunIds],
      run_b_ids: [...agreement.bRunIds],
      report_hashes: [...agreement.reportHashes],
      n: agreement.agreement.severity.n,
      severity_agreement: agreement.agreement.severity.agreement,
      severity_kappa: agreement.agreement.severity.kappa,
      routing_agreement: agreement.agreement.routing.agreement,
      routing_kappa: agreement.agreement.routing.kappa,
      evidence_agreement: agreement.agreement.evidence.agreement,
      evidence_kappa: agreement.agreement.evidence.kappa,
      overall_agreement: agreement.agreement.overall.agreement,
      overall_kappa: agreement.agreement.overall.kappa,
      // created_at defaults to now() server-side.
    });
  }
}
