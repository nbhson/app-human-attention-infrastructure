/**
 * `ChangeStatusSubscriber` (day-14 §2.5) — the *only* writer of `changes.status`.
 *
 * Change status is event-driven, never mutated from an API handler:
 *
 *   - `verification.completed` (PASSED) → `PENDING`  → `VERIFIED`
 *   - `review.decision_submitted`       → `VERIFIED` → `REVIEWED`
 *   - `artifact.rollback_requested`     → any        → `ROLLED_BACK`
 *
 * Every transition is a guarded `UPDATE` (optionally narrowed to a source state
 * with `IN (...)`), so an out-of-order or re-delivered event matches 0 rows and
 * is a correct no-op — there is nothing to log for at-least-once delivery
 * (day-14 §6).
 *
 * The events consumed here are published on Days 15 (`verification.completed`),
 * 22 (`review.decision_submitted`), and 24 (`artifact.rollback_requested`);
 * until then the subscriber is wired but idle, exercised only by direct bus
 * publishes in tests.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { ChangeStatus, EventType, VerificationStatus } from '@harness/domain';
import type {
  ArtifactRollbackRequestedPayload,
  ChangeID,
  DecisionSubmittedPayload,
  VerificationCompletedPayload,
} from '@harness/domain';
import { changes } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';

export class ChangeStatusSubscriber {
  constructor(
    private readonly db: DrizzleDB,
    private readonly logger?: Logger,
  ) {}

  /** Subscribe to all three status-driving events; returned handlers are fire-and-forget. */
  subscribe(bus: IEventBus): void {
    bus.subscribe<VerificationCompletedPayload>(EventType.VerificationCompleted, (event) => {
      void this.onVerificationCompleted(event.payload).catch((error) => {
        this.logger?.error('change status: apply VERIFIED failed', {
          correlation_id: event.correlation_id,
          change_id: event.payload.change_id,
          error: String(error),
        });
      });
    });

    bus.subscribe<DecisionSubmittedPayload>(EventType.DecisionSubmitted, (event) => {
      void this.onDecisionSubmitted(event.payload).catch((error) => {
        this.logger?.error('change status: apply REVIEWED failed', {
          correlation_id: event.correlation_id,
          change_id: event.payload.change_id,
          error: String(error),
        });
      });
    });

    bus.subscribe<ArtifactRollbackRequestedPayload>(
      EventType.ArtifactRollbackRequested,
      (event) => {
        void this.onRollbackRequested(event.payload).catch((error) => {
          this.logger?.error('change status: apply ROLLED_BACK failed', {
            correlation_id: event.correlation_id,
            change_id: event.payload.change_id,
            error: String(error),
          });
        });
      },
    );
  }

  private async onVerificationCompleted(payload: VerificationCompletedPayload): Promise<void> {
    if (payload.status !== VerificationStatus.Passed) {
      return;
    }
    await setChangeStatus(this.db, payload.change_id, ChangeStatus.Verified, [
      ChangeStatus.Pending,
    ]);
  }

  private async onDecisionSubmitted(payload: DecisionSubmittedPayload): Promise<void> {
    await setChangeStatus(this.db, payload.change_id, ChangeStatus.Reviewed, [
      ChangeStatus.Verified,
    ]);
  }

  private async onRollbackRequested(payload: ArtifactRollbackRequestedPayload): Promise<void> {
    await setChangeStatus(this.db, payload.change_id, ChangeStatus.RolledBack);
  }
}

/** Guarded status write; `from` narrows the transition, an omitted `from` allows any source. */
async function setChangeStatus(
  db: DrizzleDB,
  changeId: ChangeID,
  next: ChangeStatus,
  from?: readonly ChangeStatus[],
): Promise<void> {
  const guard = from?.length
    ? and(eq(changes.id, changeId), inArray(changes.status, from))
    : eq(changes.id, changeId);
  await db.update(changes).set({ status: next }).where(guard);
}
