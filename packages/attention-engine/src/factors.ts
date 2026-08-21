/**
 * Phase-1 factor extractors (day-18 §2.2).
 *
 * Each extractor is a **pure** function over a slice of the already-fetched
 * `ScoringInput` — no Date.now(), no I/O, so assessments stay deterministic and
 * reproducible from stored data (day-18 §6). Each returns a `[0, 1]` score, or
 * `null` when the underlying evidence is missing (`null` ⇒ weight redistributed,
 * see {@link import('./scoring.js').computePriority}).
 *
 * The four-way {@link VerificationVerdict} is the one `@harness/db` cannot store
 * verbatim: `verification_reports.overall` is only `PASSED`/`FAILED`, with the
 * `flaky` flag separating FLAKY. `TIMED_OUT` is retained for spec fidelity (the
 * overall report cannot currently be TIMED_OUT — a timed-out check fails the
 * report), but the extractor maps it if it ever appears.
 */

/** A normalized verdict from `verification_reports` (overall + flaky). */
export type VerificationVerdict = 'PASSED' | 'FAILED' | 'FLAKY' | 'TIMED_OUT';

const SECRETS_PATH = /(\.env|credential|secret)/i;
const CRITICAL_PATHS = ['packages/domain', 'migrations'];

function isCriticalPath(path: string): boolean {
  return CRITICAL_PATHS.some((needle) => path.includes(needle));
}

/**
 * `risk` — how likely the change introduces a defect.
 *
 * Verification verdict `FAILED=0.9 / FLAKY=0.6 / TIMED_OUT=0.7 / PASSED=0.1`,
 * plus `+0.1` when a secrets-adjacent path (`*.env*`, `*credentials*`) was
 * touched, capped at `1.0`. Returns `null` when there is no verification report.
 */
export function extractRisk(
  verdict: VerificationVerdict | null,
  paths: readonly string[],
): number | null {
  if (verdict === null) {
    return null;
  }
  const base =
    verdict === 'FAILED' ? 0.9 : verdict === 'FLAKY' ? 0.6 : verdict === 'TIMED_OUT' ? 0.7 : 0.1;
  const secrets = paths.some((path) => SECRETS_PATH.test(path));
  return Math.min(1, base + (secrets ? 0.1 : 0));
}

/**
 * `impact` — blast radius of the change.
 *
 * `min(1, files_touched/10)` blended 50/50 with path criticality, where a file
 * under `packages/domain/` or `migrations/` counts **double** (day-18 §2.2).
 * Returns `null` when no artifact paths are known.
 */
export function extractImpact(fileCount: number, paths: readonly string[]): number | null {
  if (fileCount <= 0) {
    return null;
  }
  const fileRatio = Math.min(1, fileCount / 10);
  const weighted = paths.reduce((sum, path) => sum + (isCriticalPath(path) ? 2 : 1), 0);
  const criticality = Math.min(1, weighted / 10);
  return 0.5 * fileRatio + 0.5 * criticality;
}

/**
 * `novelty` — how unseen the changed pattern is.
 *
 * `1.0` when the path combination was never assessed before, `0.2` when seen
 * `≥3` times, linear in between. Always available: a zero history is a valid
 * signal, not missing evidence.
 */
export function extractNovelty(priorAssessmentCount: number): number {
  if (priorAssessmentCount <= 0) {
    return 1;
  }
  if (priorAssessmentCount >= 3) {
    return 0.2;
  }
  return 1 - 0.3 * priorAssessmentCount;
}

/**
 * `complexity` — how large and multi-step the change is.
 *
 * `min(1, (addedLines + removedLines) / 500)` blended 50/50 with trajectory
 * length `min(1, steps/20)`. Always available (a small diff or a single answer
 * are valid scores, not missing evidence).
 */
export function extractComplexity(
  addedLines: number,
  removedLines: number,
  trajectoryStepCount: number,
): number {
  const lineRatio = Math.min(1, (addedLines + removedLines) / 500);
  const stepRatio = Math.min(1, trajectoryStepCount / 20);
  return 0.5 * lineRatio + 0.5 * stepRatio;
}

/**
 * `confidenceScore` — a *proxy* for how confident we are the change is correct.
 *
 * The agent's self-report is untrusted by design (day-18 §2.2). The proxy is
 * `1 − risk_proxy`, where `risk_proxy` derives from the verification verdict
 * plus retry pressure (`retry_log` rows × 0.15, capped at 0.5). Returns `null`
 * only when both signals are absent.
 *
 * > Phase 2 calibration replaces **this one function** — keep it clearly
 * > marked and free of side effects so it can be swapped, not excavated.
 */
export function extractConfidence(
  verdict: VerificationVerdict | null,
  retryCount: number,
): number | null {
  const verifyRisk =
    verdict === 'FAILED'
      ? 0.9
      : verdict === 'FLAKY'
        ? 0.6
        : verdict === 'TIMED_OUT'
          ? 0.7
          : verdict === 'PASSED'
            ? 0.1
            : null;
  const retryRisk = Math.min(0.5, retryCount * 0.15);

  if (verifyRisk === null && retryCount === 0) {
    return null;
  }
  const riskProxy = Math.min(1, (verifyRisk ?? 0) + retryRisk);
  return 1 - riskProxy;
}
