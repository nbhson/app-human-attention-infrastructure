/**
 * Replay errors (day-08 §2.2, §3.2).
 *
 * A replay must reproduce the recorded trajectory exactly; any deviation is a
 * hard error, never a warning. Two error types:
 *  - {@link ReplayDivergenceError} — a structural divergence found while walking
 *    the steps (an index gap/duplicate, an out-of-order sequence).
 *  - {@link TrajectoryHashMismatchError} — the content hash of the loaded steps
 *    does not equal the recorded hash (§2.3). It is a *divergence* (subtypes
 *    `ReplayDivergenceError`) but a distinct one: it is raised *before* any step
 *    is replayed, because replaying a hash-mismatched stream would execute
 *    divergent behavior.
 */

/** A structural divergence between the replayed stream and the recorded one. */
export class ReplayDivergenceError extends Error {
  constructor(detail: string) {
    super(`Replay diverged from the recorded trajectory: ${detail}`);
    this.name = 'ReplayDivergenceError';
  }
}

/** The loaded trajectory's content hash does not match its recorded hash. */
export class TrajectoryHashMismatchError extends ReplayDivergenceError {
  constructor(expected: string, actual: string) {
    super(`content hash mismatch — recorded ${expected}, computed ${actual}`);
    this.name = 'TrajectoryHashMismatchError';
  }
}
