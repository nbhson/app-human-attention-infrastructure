import { and, eq } from 'drizzle-orm';

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
 * The Drizzle implementation of the {@link WritebackLogStore} port (day-08).
 *
 * Idempotency is *claim-then-write*: `claim` atomically checks for an existing
 * `SUCCEEDED` row with the same `dedup_key` and records either `DUPLICATE` (no
 * proceed) or `PENDING` (proceed). `finalize` moves a claimed row to its terminal
 * state; the `SUCCEEDED` update races the partial unique index on
 * `(dedup_key) WHERE status = 'SUCCEEDED'`, so a concurrent identical write
 * degrades its late winner to `DUPLICATE` rather than double-recording a success.
 * A `FAILED` update has no constraint to race and writes its redacted `error`.
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
      const existing = await tx
        .select({ id: writebackLog.id })
        .from(writebackLog)
        .where(
          and(eq(writebackLog.dedup_key, input.dedupKey), eq(writebackLog.status, 'SUCCEEDED')),
        )
        .limit(1);

      const status: WritebackStatus = existing.length > 0 ? 'DUPLICATE' : 'PENDING';

      await tx.insert(writebackLog).values({
        id: input.intentId,
        provider: input.provider,
        external_id: input.externalId,
        action: input.action,
        body: input.body,
        dedup_key: input.dedupKey,
        status,
        ...(input.decisionId === undefined ? {} : { decision_id: input.decisionId }),
      });

      return existing.length > 0 ? 'duplicate' : 'claimed';
    });
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
