/**
 * Canonical trajectory hashing (day-08 §2.3).
 *
 * `hashSteps` is the integrity anchor for replay: it folds a {@link TrajectoryStep}
 * list into a SHA-256 over a canonical, key-sorted serialisation, so two
 * byte-equal trajectories hash identically and any single changed byte flips the
 * digest. Unlike `JSON.stringify` (insertion-order/`undefined`-sensitive), the
 * canonical form sorts object keys and drops `undefined`, so reordering object
 * keys inside a `toolInput` does not masquerade as a content change.
 */

import { createHash } from 'node:crypto';

import type { TrajectoryStep } from '@harness/domain';

/** Recursively normalise a JSON value: sort object keys, drop `undefined`, keep arrays ordered. */
function stable(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] !== undefined) {
      out[key] = stable(source[key]);
    }
  }
  return out;
}

/** Canonical string form of a JSON-ish value (`undefined`-safe, key-sorted). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(stable(value));
}

/** The canonical digest input for one step: field set varies with step `type`. */
function canonicalStep(step: TrajectoryStep): unknown {
  switch (step.type) {
    case 'THOUGHT':
      return stable({
        type: step.type,
        stepIndex: step.stepIndex,
        timestamp: step.timestamp.toISOString(),
        content: step.content,
        modelUsed: step.modelUsed,
        promptHash: step.promptHash,
      });
    case 'TOOL_CALL':
      return stable({
        type: step.type,
        stepIndex: step.stepIndex,
        timestamp: step.timestamp.toISOString(),
        toolName: step.toolName,
        toolInput: step.toolInput,
        toolOutput: step.toolOutput,
      });
    case 'OBSERVATION':
      return stable({
        type: step.type,
        stepIndex: step.stepIndex,
        timestamp: step.timestamp.toISOString(),
        content: step.content,
      });
  }
}

/** SHA-256 (hex) of the canonical serialisation of `steps`. */
export function hashSteps(steps: readonly TrajectoryStep[]): string {
  return createHash('sha256')
    .update(JSON.stringify(steps.map(canonicalStep)))
    .digest('hex');
}
