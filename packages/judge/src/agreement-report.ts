/**
 * `AgreementReport` (day-22 §3.3) — turns a set of matched judge runs into a
 * persisted inter-judge agreement computation.
 *
 * It is a thin orchestrator over the pure {@link computeAgreement} math: it
 * extracts the score pairs from the runs, computes the per-dimension agreement,
 * and records one `judge_agreements` row carrying the very run ids + report
 * hashes it was computed from, so the number can be recomputed from the audit
 * rows later (a screenshot is not an audit).
 */

import type { JudgeAgreement, JudgeAgreementStore, JudgeRun } from '@harness/domain';

import { computeAgreement } from './agreement.js';

/** A matched pair of complete judge runs over the same report (day-22 §2.3). */
export interface JudgeRunPair {
  readonly a: JudgeRun;
  readonly b: JudgeRun;
}

export class AgreementReport {
  constructor(private readonly store: JudgeAgreementStore) {}

  /**
   * Compute and persist the agreement over the matched run pairs.
   *
   * @throws if any pair's two runs judged different report content (their
   * `reportHash` must match — agreement is only meaningful over one report).
   */
  async record(pairs: readonly JudgeRunPair[]): Promise<JudgeAgreement> {
    for (const pair of pairs) {
      if (pair.a.reportHash !== pair.b.reportHash) {
        throw new Error(`AgreementReport: run ${pair.a.id} and ${pair.b.id} judged different report content`);
      }
    }

    const agreement = computeAgreement(pairs.map((pair) => ({ a: pair.a.scores, b: pair.b.scores })));

    await this.store.record({
      aRunIds: pairs.map((pair) => pair.a.id),
      bRunIds: pairs.map((pair) => pair.b.id),
      reportHashes: pairs.map((pair) => pair.a.reportHash),
      agreement,
      createdAt: new Date(),
    });

    return agreement;
  }
}
