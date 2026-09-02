/**
 * Day-39 §3.4 judge-agreement report — `pnpm judge:agreement-report`.
 *
 * Recomputes inter-judge + judge-vs-gold agreement **from the audit rows**, with
 * full provenance. Unlike the Week-5 checkpoint (which computed agreement over
 * in-memory `JudgeScorePair`s), this reporter persists the demo judges' runs
 * through the *real* `judge_runs` / `judge_agreements` stores (an isolated
 * Postgres schema), then **reads them back** and recomputes the agreement from
 * the stored rows — proving the numbers are reproducible from the audit trail,
 * not just asserted (day-39 §2.2: "a screenshot is not an audit").
 *
 * The judge is still the deterministic two-rater demonstration scorer (no live
 * LLM / no key — the repo never carries one). Gold labels are human-created and
 * live in the corpus, never in `judge_runs`; judge-vs-gold is therefore
 * recomputed by joining the read-back runs to the in-memory gold by report id.
 *
 * Runs hermetically: `createTestDb('harness_judge_report')` builds an isolated
 * schema, applies migrations, and drops it at the end. The only external
 * dependency is a reachable Postgres
 * (`postgres://harness:harness@localhost:5432/harness` default).
 */

import { asc } from 'drizzle-orm';

import {
  DrizzleJudgeAgreementStore,
  DrizzleJudgeRunStore,
  judgeAgreements,
  judgeRuns,
  reviewReports,
} from '@harness/db';
import { createTestDb, destroyTestDb } from '@harness/db/test-utils';
import { newJudgeRunID } from '@harness/domain';
import type { JudgeRun, JudgeRunID, JudgeScores, ReviewReportID } from '@harness/domain';
import { AgreementReport, canonicalReportHash, computeAgreement, RUBRIC_PROMPT_VERSION } from '@harness/judge';
import type { JudgeRunPair, JudgeScorePair } from '@harness/judge';
import { computeGoldAgreement, loadSeedExamples, reportFromExample } from '@harness/benchmark';

const SCHEMA = 'harness_judge_report';

// ---------------------------------------------------------------------------
// Deterministic demo judge — same seeded two-rater scorer as the Day-25
// checkpoint, so this reporter's numbers line up with `benchmark:regression`.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function score(severity: number, routing: number, useful: boolean, rng: () => number): JudgeScores {
  const jitter = (value: number) => clamp01(value + (rng() - 0.5) * 0.25);
  const overall = useful ? 0.55 + rng() * 0.3 : 0.2 + rng() * 0.25;
  return {
    severityAgreement: jitter(severity),
    routingAgreement: jitter(routing),
    evidenceSufficiency: 0.65 + rng() * 0.25,
    overall,
  };
}

function makeRun(
  id: JudgeRunID,
  reportId: ReviewReportID,
  prUrl: string,
  reportHash: string,
  model: string,
  temperature: number,
  scores: JudgeScores,
  reasoning: string,
): JudgeRun {
  return {
    id,
    reportId,
    prUrl,
    promptVersion: RUBRIC_PROMPT_VERSION,
    model,
    temperature,
    reportHash,
    scores,
    reasoning,
    createdAt: new Date(),
  };
}

function rowScores(row: {
  severity_agreement: number;
  routing_agreement: number;
  evidence_sufficiency: number;
  overall: number;
}): JudgeScores {
  return {
    severityAgreement: row.severity_agreement,
    routingAgreement: row.routing_agreement,
    evidenceSufficiency: row.evidence_sufficiency,
    overall: row.overall,
  };
}

function fmt3(value: number): string {
  return value.toFixed(3);
}

async function main(): Promise<void> {
  console.log();
  console.log('judge:agreement-report — day-39 §3.4 (recompute inter-judge + judge-vs-gold from audit rows)');
  console.log();

  const examples = loadSeedExamples();
  console.log(`  corpus: ${examples.length} redacted gold-labelled review examples`);
  console.log('  judge:  deterministic two-rater demonstration scorer (no live LLM / no API key)');
  console.log(`  store:  isolated Postgres schema "${SCHEMA}" (dropped on exit)`);
  console.log();

  const testDb = await createTestDb(SCHEMA);
  try {
    const db = testDb.db;
    const runStore = new DrizzleJudgeRunStore(db);
    const agreementReport = new AgreementReport(new DrizzleJudgeAgreementStore(db));

    // ---- 1. persist review_reports + judge_runs (provenance rows) --------- //
    const raterA = mulberry32(1);
    const raterB = mulberry32(2);

    const runsA: JudgeRun[] = [];
    const runsB: JudgeRun[] = [];
    const reportIdByExample = new Map<string, ReviewReportID>();

    for (let index = 0; index < examples.length; index += 1) {
      const example = examples[index]!;
      const report = reportFromExample(example); // stable per-example report + id
      const reportHash = canonicalReportHash(report);
      reportIdByExample.set(example.id, report.id);

      // The benchmark's redacted stand-in for the `pr_payload` PullRequest
      // snapshot: source + requirement + diff, so the row is audit-replayable
      // (no diff → nothing to re-hash later; the hash keys the judged artifact).
      await db.insert(reviewReports).values({
        id: report.id,
        pr_url: report.prUrl,
        pr_number: index + 1,
        repo: 'benchmark/corpus',
        pr_title: report.prTitle,
        ai_provider: report.aiProvider,
        model: report.model,
        summary: report.summary,
        overall_verdict: report.overallVerdict,
        pr_payload: {
          source: example.source,
          requirement: example.requirement,
          prDiff: example.prDiff,
        },
      });

      const scoresA = score(example.gold.severity, example.gold.routing, example.gold.useful, raterA);
      const scoresB = score(example.gold.severity, example.gold.routing, example.gold.useful, raterB);

      runsA.push(
        makeRun(
          newJudgeRunID(),
          report.id,
          report.prUrl,
          reportHash,
          'demo-rater-a',
          0,
          scoresA,
          `deterministic demo rater A (seed 1) over ${example.id}`,
        ),
      );
      runsB.push(
        makeRun(
          newJudgeRunID(),
          report.id,
          report.prUrl,
          reportHash,
          'demo-rater-b',
          0,
          scoresB,
          `deterministic demo rater B (seed 2) over ${example.id}`,
        ),
      );
    }

    for (const run of [...runsA, ...runsB]) {
      await runStore.record(run);
    }

    // ---- 2. inter-judge agreement → persisted judge_agreements row ---------- //
    const pairs: JudgeRunPair[] = runsA.map((a, index) => ({ a, b: runsB[index]! }));
    const persisted = await agreementReport.record(pairs);

    // ---- 3. read the audit rows back and recompute (the whole point) ------ //
    // Order by report_id first, then model: each report contributes [rater-a, rater-b]
    // as a consecutive pair, so iterating two-at-a-time re-pairs the two raters
    // that judged the *same* report (the only pairs agreement is meaningful over).
    const runs = await db.select().from(judgeRuns).orderBy(asc(judgeRuns.report_id), asc(judgeRuns.model));
    const agreementRows = await db.select().from(judgeAgreements);

    // Re-pair by report_id (model sort puts rater-a before rater-b per report).
    const readPairs: JudgeScorePair[] = [];
    for (let i = 0; i < runs.length; i += 2) {
      readPairs.push({ a: rowScores(runs[i]!), b: rowScores(runs[i + 1]!) });
    }
    const recomputedInterJudge = computeAgreement(readPairs);

    // judge-vs-gold: join read-back rater-A runs to the corpus gold by report id.
    const raterAScoresByReport = new Map<string, JudgeScores>();
    for (const row of runs) {
      if (row.model === 'demo-rater-a') {
        raterAScoresByReport.set(row.report_id, rowScores(row));
      }
    }
    const judgedFromRows = examples.map((example) => {
      const reportId = reportIdByExample.get(example.id)!;
      const judge = raterAScoresByReport.get(reportId)!;
      return { example, judge };
    });
    const recomputedGold = computeGoldAgreement(judgedFromRows);

    // ---- 4. render the report with full provenance ----------------------- //
    console.log('## persisted audit rows');
    console.log();
    console.log(`  judge_runs:         ${runs.length} rows (${examples.length} reports × 2 raters)`);
    console.log(`  judge_agreements:   ${agreementRows.length} row(s)`);
    console.log();

    console.log('## provenance — per-example run ids + report hashes');
    console.log();
    for (let index = 0; index < examples.length; index += 1) {
      const example = examples[index]!;
      const a = runsA[index]!;
      const b = runsB[index]!;
      console.log(
        `  ${example.id}  hash ${a.reportHash.slice(0, 12)}…  ` + `run-a ${a.id}  run-b ${b.id}  pr ${a.prUrl}`,
      );
    }
    console.log();

    console.log('## inter-judge agreement (recomputed from judge_runs)');
    console.log();
    console.log(
      `  severity: agreement=${fmt3(recomputedInterJudge.severity.agreement)}  ` +
        `κ=${fmt3(recomputedInterJudge.severity.kappa)}  n=${recomputedInterJudge.severity.n}`,
    );
    console.log(
      `  routing:  agreement=${fmt3(recomputedInterJudge.routing.agreement)}  ` +
        `κ=${fmt3(recomputedInterJudge.routing.kappa)}  n=${recomputedInterJudge.routing.n}`,
    );
    console.log(
      `  evidence: agreement=${fmt3(recomputedInterJudge.evidence.agreement)}  ` +
        `κ=${fmt3(recomputedInterJudge.evidence.kappa)}  n=${recomputedInterJudge.evidence.n}`,
    );
    console.log();

    console.log('## judge-vs-gold agreement (recomputed from judge_runs × corpus gold)');
    console.log();
    console.log(
      `  n=${examples.length}  severity=${fmt3(recomputedGold.severity)}  ` +
        `routing=${fmt3(recomputedGold.routing)}  usefulness=${fmt3(recomputedGold.usefulness)}`,
    );
    console.log();

    // The agreement figure persisted via the real AgreementReport must match the
    // number recomputed phrase-by-phrase from the read-back judge_runs rows.
    const severityMatches =
      Math.abs(persisted.severity.agreement - recomputedInterJudge.severity.agreement) < 1e-9 &&
      Math.abs(persisted.routing.agreement - recomputedInterJudge.routing.agreement) < 1e-9 &&
      Math.abs(persisted.evidence.agreement - recomputedInterJudge.evidence.agreement) < 1e-9;
    if (!severityMatches) {
      throw new Error(
        'recompute mismatch: persisted judge_agreements row does not equal the agreement ' +
          'recomputed from judge_runs — the audit trail is not reproducible',
      );
    }

    console.log('  recompute check: persisted judge_agreements row ≡ agreement recomputed from');
    console.log('  judge_runs (within 1e-9) — the number is reproducible from the audit rows.');
    console.log();

    if (agreementRows[0]) {
      const row = agreementRows[0];
      console.log('  persisted agreement row');
      console.log(`    id            ${row.id}`);
      console.log(`    run_a_ids     [${row.run_a_ids.join(', ')}]`);
      console.log(`    run_b_ids     [${row.run_b_ids.join(', ')}]`);
      console.log(`    report_hashes [${row.report_hashes.slice(0, 3).join(', ')}…]`);
      console.log(`    severity       ${fmt3(row.severity_agreement)}  κ ${fmt3(row.severity_kappa)}`);
      console.log(`    routing        ${fmt3(row.routing_agreement)}  κ ${fmt3(row.routing_kappa)}`);
      console.log();
    }

    console.log('  honesty boundary: the scorer is a seeded PRNG, so these numbers reproduce the');
    console.log('  audit mechanism — they do not measure live-judge drift (no key, by design).');
    console.log();
  } finally {
    await destroyTestDb(testDb, SCHEMA);
  }
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('[judge:agreement-report] FAILED:', error);
    process.exit(1);
  },
);
