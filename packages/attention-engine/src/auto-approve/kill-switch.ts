/**
 * Auto-approve kill-switch + feature flag (day-14 §2.2).
 *
 * One DB row (`auto_approve_kill_switch.id = 'singleton'`) holds both controls the
 * executor consults on every decision:
 *
 *  - `auto_approve_enabled` — the flag; off by default, toggled by ADMIN.
 *  - `enabled` — the kill-switch (false = KILLED).
 *
 * Killing is literal and immediate: a single UPDATE flips `enabled` to false and
 * the executor refuses, and {@link requeueInFlight} re-opens every in-flight
 * `AUTO_APPROVABLE` queue row to human review (`action → REVIEW_REQUIRED`,
 * `deferred_until` cleared) — an auto-approve that was computed but not yet
 * completed is caught, not trusted to "the next run" (§6).
 */

import { and, eq } from 'drizzle-orm';

import { autoApproveKillSwitch, reviewQueue } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

/** The singleton row id (seeded by the migration). */
export const AUTO_APPROVE_KILL_SWITCH_ID = 'singleton';

/** The live flag + kill-switch snapshot the executor reads. */
export interface AutoApproveSwitchState {
  readonly flagEnabled: boolean;
  readonly killed: boolean;
}

export class AutoApproveKillSwitch {
  constructor(private readonly db: DrizzleDB) {}

  /** Read the singleton row, defaulting to off/killed when absent. */
  async read(): Promise<AutoApproveSwitchState> {
    const rows = await this.db
      .select({
        flag: autoApproveKillSwitch.auto_approve_enabled,
        enabled: autoApproveKillSwitch.enabled,
      })
      .from(autoApproveKillSwitch)
      .where(eq(autoApproveKillSwitch.id, AUTO_APPROVE_KILL_SWITCH_ID))
      .limit(1);
    const row = rows[0];
    return {
      // A missing row means the kill-switch is not live → refuse (never auto-approve).
      flagEnabled: row?.flag ?? false,
      killed: row ? row.enabled === false : true,
    };
  }

  /** True when the kill-switch is tripped (or the row is absent). */
  async isKilled(): Promise<boolean> {
    return (await this.read()).killed;
  }

  /** True when the ADMIN-enabled feature flag is on. */
  async isFlagEnabled(): Promise<boolean> {
    return (await this.read()).flagEnabled;
  }

  /** Toggle the feature flag (ADMIN only; the route enforces the role). */
  async setFlagEnabled(enabled: boolean): Promise<void> {
    await this.db
      .update(autoApproveKillSwitch)
      .set({ auto_approve_enabled: enabled })
      .where(eq(autoApproveKillSwitch.id, AUTO_APPROVE_KILL_SWITCH_ID));
  }

  /**
   * Trip the kill-switch and requeue in-flight auto-approvables in one logical
   * step. `killedBy` is the ADMIN actor (`null` allowed for tests/standalone use).
   */
  async kill(killedBy: string | null, reason: string): Promise<void> {
    await this.db
      .update(autoApproveKillSwitch)
      .set({ enabled: false, killed_at: new Date(), killed_by: killedBy, reason })
      .where(eq(autoApproveKillSwitch.id, AUTO_APPROVE_KILL_SWITCH_ID));
    await this.requeueInFlight();
  }

  /**
   * Re-open every in-flight `AUTO_APPROVABLE` row to human review. The row is
   * already `QUEUED`; flipping the action makes the human queue see it, and
   * clearing `deferred_until` makes it actionable now rather than "tomorrow".
   */
  private async requeueInFlight(): Promise<void> {
    await this.db
      .update(reviewQueue)
      .set({ action: 'REVIEW_REQUIRED', rule_id: 'kill-switch-requeue', deferred_until: null })
      .where(and(eq(reviewQueue.action, 'AUTO_APPROVABLE'), eq(reviewQueue.status, 'QUEUED')));
  }
}
