/**
 * Verification event payloads (verification spec §2.2).
 */

import type { VerificationRequestID, VerificationResultID } from '../ids.js';
import type { VerificationStatus } from '../verification.js';

/** Payload for {@link import('./event-types.js').EventType.VerificationCompleted}. */
export interface VerificationCompletedPayload {
  /** The verification request that was answered. */
  readonly request_id: VerificationRequestID;
  /** The aggregated result. */
  readonly result_id: VerificationResultID;
  /** Overall verification status. */
  readonly status: VerificationStatus;
  /** Human-readable per-check summaries. */
  readonly check_summaries: string[];
}
