/**
 * Heuristic error classifier (day-10 §3.2).
 *
 * Turns an untyped thrown error into a {@link ClassifiedFailure} by matching
 * the message text against known signatures. It is deliberately conservative:
 * anything unrecognised falls through to `PERMANENT` rather than risking a
 * pointless retry loop on genuinely-broken input.
 *
 * This is a heuristic and *will* misclassify occasionally. The `raw` field on
 * the result preserves the original message so the classifier can be improved
 * later without re-running the tasks that produced the misclassification.
 */

import type { ClassifiedFailure } from './failure-class.js';

const TRANSIENT_PATTERN = /ECONNRESET|ETIMEDOUT|STEP_TIMEOUT|ECONNREFUSED/i;
const RESOURCE_PATTERN = /RATE_LIMIT|TOKEN_BUDGET|QUOTA/i;

export function classifyError(err: unknown): ClassifiedFailure {
  const msg = err instanceof Error ? err.message : String(err);

  if (TRANSIENT_PATTERN.test(msg)) {
    return { class: 'TRANSIENT', message: msg, raw: msg };
  }
  if (RESOURCE_PATTERN.test(msg)) {
    return { class: 'RESOURCE', message: msg, raw: msg };
  }
  return { class: 'PERMANENT', message: msg, raw: msg };
}
