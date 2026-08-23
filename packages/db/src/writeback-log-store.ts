import { eq, sql } from 'drizzle-orm';

import type { WritebackClaim, WritebackFinalize, WritebackLogStore } from '@harness/domain';

import type { DrizzleDB } from './client.js';
import { writebackLog } from './schema/index.js';

/** `writeback_log` rows (day-08 §2.1). `body`/`dedup_key` use the column's snake_case name. */
type WritebackStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'DUPLICATE';

/**
 * Postgres SQLSTATE for a unique-constraint/index violation (`23505`). The
 * postgres.js driver surfaces it as `error.code`; Drizzle wraps that driver
 * error as the `cause` of a `DrizzleQueryError`, so both shapes are checked
 * (day-08 §6). A losing race against the partial unique index is what turns a
 * second `SUCCEEDED` into a `DUPLICATE`, and it must be distinguishable from
 * any other write failure.
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ((error as { code?: unknown }).code === '23505') {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === '23505'
  );
}

/**
 * The Drizzle implementation of the {@link WritebackLogStore} port (day-08,
 * hardened day-36).
 *
 * Idempotency is *claim-then-write*: `claim` attempts an `ON CONFLICT DO NOTHING`
 * insert against the in-flight partial unique index, recording `PENDING` when it
 * wins and `DUPLICATE` (no proceed) when a racing or prior identical claim holds
 * the key. Since day-36 the index scopes to `PENDING`/`SUCCEEDED` (not just
 * `SUCCEEDED`), so a **concurrent** identical claim — or a retry that races a
 * crashed `PENDING` — resolves to `DUPLICATE` *before any external call*.
 * `finalize` moves a claimed row to its terminal state; the `SUCCEEDED` update
 * still races the index, so a late winner degrades to `DUPLICATE` rather than
 * double-recording a success. A `FAILED` update has no constraint to race and
 * writes its redacted `error`.
 *
 * The `WHERE` scopes to `PENDING`/`SUCCEEDED` — not `FAILED` — so a failed
 * attempt's row leaves the index and a retry may append a fresh `PENDING` row
 * (retry-after-failure is safe: the external write did not happen).
 *
 * The row id is the *intent id* (see {@link WritebackClaim.intentId}); each
 * attempt carries a fresh intent id from the caller, so a retry of the same
 * intent appends a new, `DUPLICATE`-able row rather than mutating the first
 * (the log is append-only — day-08 §2.1).
 */
export class DrizzleWritebackLogStore implements WritebackLogStore {
  constructor(private readonly db: DrizzleDB) {}

  async claim(input: WritebackClaim): Promise<'claimed' | 'duplicate'> {
    return this.db.transaction(async (tx) => {
      // The in-flight partial unique index — `(dedup_key) WHERE status IN
      // ('PENDING','SUCCEEDED')` — is the atomic serialization point. We try to
      // insert a `PENDING` row with `ON CONFLICT DO NOTHING` targeting that
      // index; when a racing identical claim already holds the key (still
      // PENDING or already SUCCEEDED), this inserts nothing, and we record the
      // audit skip without ever reaching the external host (day-36 §2.1).
      const attempted = await tx
        .insert(writebackLog)
        .values(this.rowValues(input, 'PENDING'))
        .onConflictDoNothing({
          target: writebackLog.dedup_key,
          where: sql`${writebackLog.status} IN ('PENDING', 'SUCCEEDED')`,
        })
        .returning({ id: writebackLog.id });

      if (attempted.length > 0) {
        return 'claimed';
      }
      await tx.insert(writebackLog).values(this.rowValues(input, 'DUPLICATE'));
      return 'duplicate';
    });
  }

  /** The audit-row values for one claim, at the given status. */
  private rowValues(input: WritebackClaim, status: WritebackStatus) {
    return {
      id: input.intentId,
      provider: input.provider,
      external_id: input.externalId,
      action: input.action,
      body: input.body,
      dedup_key: input.dedupKey,
      status,
      ...(input.decisionId === undefined ? {} : { decision_id: input.decisionId }),
    };
  }

  async finalize(input: WritebackFinalize): Promise<void> {
    if (input.status === 'SUCCEEDED') {
      try {
        await this.db
          .update(writebackLog)
          .set({ status: 'SUCCEEDED', external_ref: input.externalRef ?? null })
          .where(eq(writebackLog.id, input.intentId));
      } catch (error) {
        if (isUniqueViolation(error)) {
          // A concurrent identical write already holds the SUCCEEDED slot; this
          // attempt is a duplicate, never a second success.
          await this.db
            .update(writebackLog)
            .set({ status: 'DUPLICATE' })
            .where(eq(writebackLog.id, input.intentId));
          return;
        }
        throw error;
      }
      return;
    }

    await this.db
      .update(writebackLog)
      .set({ status: 'FAILED', error: input.error ?? null })
      .where(eq(writebackLog.id, input.intentId));
  }
}
