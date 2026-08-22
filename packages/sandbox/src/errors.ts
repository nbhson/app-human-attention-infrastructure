/**
 * Sandbox error taxonomy (day-22 §3.1): infra trouble (daemon down, image
 * missing) is distinguishable from a check that merely ran long. The
 * verification engine routes the former to its in-process fallback (§2.4) and
 * surfaces the latter as a `TIMED_OUT` report.
 */

/** The sandbox itself could not run — daemon down, docker gone, image missing. */
export class SandboxInfraError extends Error {
  override readonly name = 'SandboxInfraError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * A run was killed for exceeding its time budget. `Sandbox.run` normally
 * returns `{ timedOut: true }` rather than throwing; this error is kept for a
 * defensive branch where the kill itself fails and the caller must know the
 * budget lapsed.
 */
export class SandboxTimeoutError extends Error {
  override readonly name = 'SandboxTimeoutError';

  constructor(readonly timeoutSeconds: number) {
    super(`sandbox exceeded its ${timeoutSeconds}s budget`);
  }
}
