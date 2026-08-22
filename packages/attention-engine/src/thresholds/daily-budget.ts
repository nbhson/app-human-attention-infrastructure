/**
 * The daily review budget gate (day-13 §2.4, §3.3).
 *
 * Human review is a finite, fatigue-prone resource, so a per-UTC-day budget caps
 * how many MEDIUM/LOW items we send a human per day. CRITICAL/HIGH (and flaky —
 * which the policy maps to `REVIEW_REQUIRED`) **always** route; when the budget is
 * spent, a MEDIUM/LOW item is **deferred**, never dropped: it stays QUEUED with a
 * `deferred_until` marker (the next UTC midnight) and emits `attention.item_deferred`,
 * so "we deferred 3 items today" is a real recorded route decision, not inferred.
 */

import { gte } from 'drizzle-orm';

import { decisions } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { RoutingAction } from '@harness/domain';

/** Actions the budget gates. ESCALATE/REVIEW_REQUIRED always pass (§2.4). */
export const DEFERRABLE_ACTIONS: ReadonlySet<RoutingAction> = new Set([
  'REVIEW_RECOMMENDED',
  'AUTO_APPROVABLE',
]);

/** Midnight UTC for a given instant — fatigue math is timezone-explicit (§6). */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The next UTC midnight strictly after `date` (a deferral's `deferred_until`). */
export function nextUtcMidnight(date: Date): Date {
  const start = startOfUtcDay(date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** The outcome of gating one routing action against today's budget. */
export interface DeferralDecision {
  readonly deferred: boolean;
  readonly deferredUntil: Date | null;
}

/**
 * The §2.4 rule as a pure function: defer only deferrable actions when today's
 * decisions have reached the budget. `deferredUntil` is the next UTC midnight so
 * the item re-enters contention at the day boundary.
 */
export function decideDeferral(
  action: RoutingAction,
  decisionsToday: number,
  budget: number,
  now: Date,
): DeferralDecision {
  if (!DEFERRABLE_ACTIONS.has(action)) {
    return { deferred: false, deferredUntil: null };
  }
  if (decisionsToday < budget) {
    return { deferred: false, deferredUntil: null };
  }
  return { deferred: true, deferredUntil: nextUtcMidnight(now) };
}

/** The `now` seam so tests can pin the day boundary deterministically. */
export interface DailyBudgetConfig {
  readonly dailyReviewBudget: number;
  /** Overrides the wall clock for tests; defaults to `new Date()`. */
  readonly now?: Date;
}

/**
 * The queue-time gate. Counts today's (UTC) human decisions and defers
 * MEDIUM/LOW once the budget is spent. Pure decision logic lives in
 * {@link decideDeferral}; this class only adds the decision-count query.
 */
export class DailyBudgetGate {
  constructor(
    private readonly db: DrizzleDB,
    private readonly config: DailyBudgetConfig,
  ) {}

  async evaluate(action: RoutingAction): Promise<DeferralDecision> {
    const now = this.config.now ?? new Date();
    if (!DEFERRABLE_ACTIONS.has(action)) {
      return { deferred: false, deferredUntil: null };
    }
    const rows = await this.db
      .select({ id: decisions.id })
      .from(decisions)
      .where(gte(decisions.created_at, startOfUtcDay(now)));
    return decideDeferral(action, rows.length, this.config.dailyReviewBudget, now);
  }
}
