/**
 * `FaultyDb` (day-28 §2.2) — a test-only fault-injection wrapper around a real
 * `DrizzleDB`.
 *
 * It wraps the handful of top-level query entry points a service calls (`select`,
 * `insert`, `update`, `delete`, `transaction`) behind a `Proxy` that can throw a
 * queued {@link Fault} *before* delegating. That models a connection drop at the
 * head of the next matching operation — deterministically: queue the fault, call
 * once, observe the unchanged state, then call again without the fault and
 * observe the retry path, with no `setTimeout`, real network failure, or actual
 * Postgres restart.
 *
 * This file is never imported from production code — it ships only behind the
 * `test-utils` export.
 */

import type { DrizzleDB } from './client.js';

/** The query entry points a fault can target. */
export type FaultOp = 'select' | 'insert' | 'update' | 'delete' | 'transaction';

/** A queued fault: throw `error` on the next `times` matching operations. */
export interface Fault {
  readonly op: FaultOp;
  readonly error: Error;
  /** How many matching operations the fault should fire on; defaults to 1. */
  readonly times?: number;
}

const FAULTABLE: ReadonlySet<string> = new Set<FaultOp>([
  'select',
  'insert',
  'update',
  'delete',
  'transaction',
]);

export class FaultyDb {
  private readonly pending: Array<{ readonly op: FaultOp; readonly error: Error; times: number }> =
    [];

  /** The proxied handle — hand this to a service in place of the real `DrizzleDB`. */
  readonly db: DrizzleDB;

  constructor(inner: DrizzleDB) {
    this.db = new Proxy(inner, {
      get: (target, prop) => {
        const value = Reflect.get(target, prop) as unknown;
        if (typeof prop === 'string' && FAULTABLE.has(prop) && typeof value === 'function') {
          return (...args: unknown[]): unknown => {
            const error = this.pop(prop as FaultOp);
            if (error) {
              throw error;
            }
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value;
      },
    });
  }

  /** Queue a fault so the next `fault.op` call(s) throw `fault.error`. */
  inject(fault: Fault): void {
    this.pending.push({ op: fault.op, error: fault.error, times: fault.times ?? 1 });
  }

  private pop(op: FaultOp): Error | null {
    const index = this.pending.findIndex((f) => f.op === op && f.times > 0);
    if (index === -1) {
      return null;
    }
    const pending = this.pending[index];
    if (!pending) {
      return null;
    }
    pending.times -= 1;
    return pending.error;
  }
}
