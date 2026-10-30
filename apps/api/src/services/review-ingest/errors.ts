/**
 * Error classes for the review-ingest slice. Kept in their own module so the
 * pipeline stages, the persister, and the route layer can share the same
 * contract without importing the orchestrator.
 */

/** A review-request failed for a user-correctable reason (bad URL, missing provider). */
export class ReviewIngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ReviewIngestError';
  }
}

/** A decision row insert failed for a non-race reason (races are handled as dedup wins). */
export class DecisionInsertError extends Error {
  constructor(cause?: unknown) {
    super('decision insert failed');
    this.name = 'DecisionInsertError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
