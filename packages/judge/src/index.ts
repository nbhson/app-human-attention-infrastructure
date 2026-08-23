/**
 * `@harness/judge` — the LLM-as-judge that scores a review report against a
 * versioned rubric (review-reorient Phase 3 day-21), plus the inter-judge
 * agreement machinery that makes the judge's quality *itself* measurable
 * (day-22): a pure {@link computeAgreement} over matched run pairs and an
 * {@link AgreementReport} that persists one audited `judge_agreements` row per
 * computation.
 *
 * The judged artifact is the **report**, never the PR's code or its author. The
 * judge calls the {@link import('@harness/domain').LLMProvider} seam with a
 * versioned rubric prompt, parses the numeric `JudgeScores`, and records the run
 * through the {@link import('@harness/domain').JudgeRunStore} seam (stamping a
 * content hash + temperature so every score is auditable and reproducible).
 * Shadow-only: nothing consumes the scores yet (day-23 feeds weight fitting).
 */

export * from './rubric.js';
export * from './judge.js';
export * from './report-hash.js';
export * from './agreement.js';
export * from './agreement-report.js';
