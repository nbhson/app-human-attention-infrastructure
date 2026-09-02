/**
 * The `WriteBackService` seam (review-reorient Phase 3 day-06) — the single entry
 * point for *commentary/status* write-back to a Git host or ticket system.
 *
 * The seam is the guardrail: an intent is `COMMENT | STATUS | LABEL | TRANSITION`
 * only — it carries no code, no commit, no diff, and adding one is a visible,
 * reviewable type change to {@link WriteBackIntent} (day-06 §2.2, §6). The
 * decision path reaches *everything* write-back through this one method, so the
 * Day-08 audit + idempotency layer plugs in at a single call site.
 */

import type { WriteBackIntent, WriteBackProvider, WriteBackResult, WritebackAction } from '@harness/domain';

/** Turn one write-back request into an outcome. */
export interface WriteBackService {
  write(intent: WriteBackIntent): Promise<WriteBackResult>;
}

/**
 * An *invalid* intent — an unsupported action for the provider, a missing repo,
 * an unknown provider — as opposed to an external write failure (which is an
 * `ok: false` {@link WriteBackResult}). Callers surface this as a client error,
 * not as a recorded FAILED write-back.
 *
 * The error carries the target identity (`provider`/`action`/`externalId`) so the
 * Day-08 audit + idempotency layer can key on one shape regardless of host
 * (day-07 §2.3).
 */
export class WriteBackError extends Error {
  constructor(
    message: string,
    options?: {
      cause?: unknown;
      provider?: WriteBackProvider;
      action?: WritebackAction;
      externalId?: string;
      status?: number;
    },
  ) {
    super(message);
    this.name = 'WriteBackError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    if (options?.provider !== undefined) {
      this.provider = options.provider;
    }
    if (options?.action !== undefined) {
      this.action = options.action;
    }
    if (options?.externalId !== undefined) {
      this.externalId = options.externalId;
    }
    if (options?.status !== undefined) {
      this.status = options.status;
    }
  }

  /** The provider the failed write targeted (when known). */
  readonly provider?: WriteBackProvider;
  /** The action attempted (when known). */
  readonly action?: WritebackAction;
  /** The target external id (PR/MR number or ticket key). */
  readonly externalId?: string;
  /** An HTTP-ish status when the host reported one. */
  readonly status?: number;
}
