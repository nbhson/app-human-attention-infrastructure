/**
 * Failure taxonomy for retry decisions (day-10 §2.1).
 *
 * Not every failure is equal. Before deciding whether to retry a step, the
 * runner classifies the failure into one of three buckets:
 *
 * - `TRANSIENT` — environmental: network blips, lock timeouts, LLM rate limits
 *   that pass on their own. Safe to retry.
 * - `PERMANENT` — the input or code is wrong: bad payloads, missing artifacts,
 *   logic errors, schema bugs. Retrying cannot help.
 * - `RESOURCE`  — a quota/space limit: token budget, disk full. Retry only
 *   after a cooldown.
 *
 * ## Classification guide for step-handler implementers
 *
 * | Error                  | FailureClass | Rationale                      |
 * |------------------------|--------------|--------------------------------|
 * | `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED` | `TRANSIENT` | network is flaky |
 * | `STEP_TIMEOUT`         | `TRANSIENT`  | slow dependency, not broken    |
 * | `23505` (unique violation) | `PERMANENT` | data conflict won't resolve |
 * | `42P01` (undefined table)  | `PERMANENT` | schema bug                  |
 * | `LLM_RATE_LIMIT`       | `RESOURCE`   | cooldown then retry            |
 * | `TOKEN_BUDGET_EXCEEDED`| `RESOURCE`   | cooldown then retry            |
 *
 * This is stable, shared vocabulary: `@harness/orchestrator` owns the const,
 * so every engine and handler names classes identically.
 */
export const FailureClass = {
  /** Environmental flakiness — retry with backoff. */
  TRANSIENT: 'TRANSIENT',
  /** Bad input or code — retrying will not help. */
  PERMANENT: 'PERMANENT',
  /** Exhausted a quota or resource — retry after cooldown. */
  RESOURCE: 'RESOURCE',
} as const;

export type FailureClass = (typeof FailureClass)[keyof typeof FailureClass];

/** A failure that has been put into a {@link FailureClass} bucket. */
export interface ClassifiedFailure {
  class: FailureClass;
  /** Human-readable message for logs. */
  message: string;
  /** Original error string for debugging (the classifier can lose detail). */
  raw: string;
}
