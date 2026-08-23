/**
 * `@harness/benchmark` — the review-quality corpus runtime (day-24).
 *
 * A versioned store of **gold-labelled review examples** — a redacted PR diff +
 * requirement + the AI's review report + the human's gold labels — plus the
 * corpus loader and the judge-vs-gold evaluation. This is the *ground truth* for
 * review-quality measurement: not a coding-task / SWE-bench-style set, but the
 * cases a careful human says the review report should have concluded.
 *
 * Read-only evaluator (day-24 §2.3): imports only `@harness/domain` (value types
 * + `LLMProvider`/judge contract), `@harness/db` (the `review_examples` table),
 * and the `@harness/judge` seam (to run the judge) — never `attention-engine`,
 * `context-engine`, or `review`.
 */

export * from './review-example.js';
export * from './corpus.js';
export * from './eval-judge.js';
export { loadSeedExamples } from './seed/seed-data.js';
