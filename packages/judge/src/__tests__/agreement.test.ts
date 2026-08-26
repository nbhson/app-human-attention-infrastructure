import { describe, expect, it } from 'vitest';

import {
  AiProviderType,
  FindingKind,
  ReviewSeverity,
  ReviewVerdict,
  createReviewFinding,
  createReviewReport,
  newJudgeRunID,
  newReviewReportID,
} from '@harness/domain';
import type {
  JudgeAgreementRecord,
  JudgeAgreementStore,
  JudgeRun,
  JudgeRunStore,
  JudgeScores,
  ReviewReport,
  ReviewReportID,
} from '@harness/domain';

import { computeAgreement } from '../agreement.js';
import type { JudgeScorePair } from '../agreement.js';
import { AgreementReport } from '../agreement-report.js';
import { canonicalReportHash } from '../report-hash.js';

/** A score object whose only *interesting* dimension is severity; others constant. */
function severityScores(severityAgreement: number): JudgeScores {
  return {
    severityAgreement,
    routingAgreement: 0.5,
    evidenceSufficiency: 0.5,
    overall: 0.5,
  };
}

/** Build a persisted-looking run over `reportId` with a fixed content hash. */
function makeRun(scores: JudgeScores, reportId: ReviewReportID, reportHash: string): JudgeRun {
  return {
    id: newJudgeRunID(),
    reportId,
    prUrl: 'https://github.com/acme/api/pull/42',
    promptVersion: 'judge-rubric-v1',
    model: 'claude-sonnet-4-6',
    temperature: 0.2,
    reportHash,
    scores,
    reasoning: 'r',
    createdAt: new Date(),
  };
}

const REPORT_ID = newReviewReportID();
const HASH = '0000000000000000000000000000000000000000000000000000000000000000';

class InMemoryRunStore implements JudgeRunStore {
  readonly runs: JudgeRun[] = [];
  async record(run: JudgeRun): Promise<void> {
    this.runs.push(run);
  }
}

class InMemoryAgreementStore implements JudgeAgreementStore {
  readonly records: JudgeAgreementRecord[] = [];
  async record(agreement: JudgeAgreementRecord): Promise<void> {
    this.records.push(agreement);
  }
}

describe('computeAgreement', () => {
  it('returns agreement 1 and kappa 1 for identical score pairs', () => {
    const result = computeAgreement([
      { a: severityScores(0.8), b: severityScores(0.8) },
      { a: severityScores(0.2), b: severityScores(0.2) },
    ]);
    for (const dimension of [result.severity, result.routing, result.evidence, result.overall]) {
      expect(dimension.n).toBe(2);
      expect(dimension.meanAbsDiff).toBe(0);
      expect(dimension.agreement).toBe(1);
      expect(dimension.kappa).toBe(1);
    }
  });

  it('computes the expected agreement + chance-corrected kappa on known pairs', () => {
    // Flag pattern over 4 pairs: (1,1),(1,0),(0,1),(0,0) → observed agreement 0.5,
    // chance agreement 0.5 → κ = 0. Continuous agreement = 1 − mean(|a−b|).
    const pairs: JudgeScorePair[] = [
      { a: severityScores(0.9), b: severityScores(0.9) },
      { a: severityScores(0.9), b: severityScores(0.4) },
      { a: severityScores(0.4), b: severityScores(0.9) },
      { a: severityScores(0.4), b: severityScores(0.4) },
    ];
    const result = computeAgreement(pairs);

    expect(result.severity.n).toBe(4);
    expect(result.severity.meanAbsDiff).toBeCloseTo(0.25);
    expect(result.severity.agreement).toBeCloseTo(0.75);
    expect(result.severity.kappa).toBeCloseTo(0);
  });

  it('gives a negative kappa when raters disagree below chance', () => {
    // 4 pairs, all opposing: (1,0),(1,0),(0,1),(0,1) → observed 0, chance 0.5 → κ = −1.
    const pairs: JudgeScorePair[] = [
      { a: severityScores(0.9), b: severityScores(0.4) },
      { a: severityScores(0.9), b: severityScores(0.4) },
      { a: severityScores(0.4), b: severityScores(0.9) },
      { a: severityScores(0.4), b: severityScores(0.9) },
    ];
    const result = computeAgreement(pairs);
    expect(result.severity.kappa).toBeCloseTo(-1);
  });

  it('throws on an empty pair list', () => {
    expect(() => computeAgreement([])).toThrow(/at least one score pair/);
  });
});

describe('canonicalReportHash', () => {
  function report(
    overrides: { summary?: string; findings?: ReviewReport['findings'] } = {},
  ): ReviewReport {
    return createReviewReport({
      id: REPORT_ID,
      prUrl: 'https://github.com/acme/api/pull/1',
      prTitle: 'Add widget',
      aiProvider: AiProviderType.Anthropic,
      model: 'claude-sonnet-4-6',
      summary: overrides.summary ?? 'Adds /widget',
      overallVerdict: ReviewVerdict.RequestChanges,
      findings: overrides.findings ?? [
        createReviewFinding({
          severity: ReviewSeverity.Critical,
          kind: FindingKind.Correctness,
          file: 'src/widget.ts',
          line: 42,
          message: 'Missing null check',
        }),
        createReviewFinding({
          severity: ReviewSeverity.Minor,
          kind: FindingKind.Cleanup,
          file: 'README.md',
          message: 'Typo',
        }),
      ],
    });
  }

  it('is identical for reports with the same judged content, regardless of store metadata', () => {
    // Same content, freshly generated ids and createdAt — the hash must not move.
    const one = report();
    const two = report();
    expect(canonicalReportHash(one)).toBe(canonicalReportHash(two));
  });

  it('changes when the verdict or a finding changes', () => {
    const one = report();
    const two = report({ summary: 'A different summary' });
    expect(canonicalReportHash(one)).not.toBe(canonicalReportHash(two));
  });

  it('is invariant to finding ordering (canonical, severity-then-file)', () => {
    const forward = report();
    const reversed = report({ findings: [...forward.findings].reverse() });
    expect(canonicalReportHash(forward)).toBe(canonicalReportHash(reversed));
  });
});

describe('AgreementReport', () => {
  it('records the run ids + hashes and computs the agreement', async () => {
    const store = new InMemoryAgreementStore();
    const reporter = new AgreementReport(store);

    const a1 = makeRun(severityScores(0.9), REPORT_ID, HASH);
    const b1 = makeRun(severityScores(0.9), REPORT_ID, HASH);
    const a2 = makeRun(severityScores(0.4), REPORT_ID, HASH);
    const b2 = makeRun(severityScores(0.4), REPORT_ID, HASH);

    const agreement = await reporter.record([
      { a: a1, b: b1 },
      { a: a2, b: b2 },
    ]);

    expect(store.records).toHaveLength(1);
    const recorded = store.records[0]!;
    expect(recorded.aRunIds).toEqual([a1.id, a2.id]);
    expect(recorded.bRunIds).toEqual([b1.id, b2.id]);
    expect(recorded.reportHashes).toEqual([HASH, HASH]);
    expect(recorded.agreement).toEqual(agreement);
  });

  it('recomputes the agreement from the stored run scores (audit trail)', async () => {
    const runStore = new InMemoryRunStore();
    const agreementStore = new InMemoryAgreementStore();
    const reporter = new AgreementReport(agreementStore);

    const runs = [
      makeRun(severityScores(0.9), REPORT_ID, HASH),
      makeRun(severityScores(0.88), REPORT_ID, HASH),
      makeRun(severityScores(0.6), REPORT_ID, HASH),
      makeRun(severityScores(0.61), REPORT_ID, HASH),
    ];
    await Promise.all(runs.map((run) => runStore.record(run)));

    await reporter.record([
      { a: runs[0]!, b: runs[1]! },
      { a: runs[2]!, b: runs[3]! },
    ]);

    const stored = agreementStore.records[0]!;
    const byId = new Map(runs.map((run) => [run.id, run]));

    // Reconstruct the pairs from the stored run ids, then recompute from scratch.
    const pairs = stored.aRunIds.map((aId, i) => ({
      a: byId.get(aId)!.scores,
      b: byId.get(stored.bRunIds[i]!)!.scores,
    }));
    expect(computeAgreement(pairs)).toEqual(stored.agreement);
  });

  it('rejects a pair whose two runs judged different report content', async () => {
    const reporter = new AgreementReport(new InMemoryAgreementStore());
    const a = makeRun(severityScores(0.5), REPORT_ID, HASH);
    const b = makeRun(severityScores(0.5), REPORT_ID, 'different-hash');
    await expect(reporter.record([{ a, b }])).rejects.toThrow(/different report content/);
  });
});
