/**
 * Attention policy — data, not code (day-19 §2.1).
 *
 * A policy maps an assessment's routing *signals* (label, combined priority,
 * flaky verification, missing factors) to a routing *decision* via ordered rules.
 * "First matching rule wins" means the rule order is itself part of the policy
 * and is unit-tested (day-19 §2.1, §6). Every decision records the matched
 * `rule_id` and `version` so old queue rows stay auditable after a policy bump.
 */

import type { RoutingAction } from '@harness/domain';

import type { FactorKey, PriorityLabel } from './types.js';

export type { RoutingAction } from '@harness/domain';

/** The routing signals a rule matches against. */
export interface RoutingInput {
  readonly label: PriorityLabel;
  readonly combinedPriority: number;
  readonly flaky: boolean;
  readonly factorsUnavailable: readonly FactorKey[];
}

/** One ordered rule. All present `when` keys must match for the rule to fire. */
export interface AttentionPolicyRule {
  readonly id: string;
  readonly when: {
    readonly minPriority?: number;
    readonly labels?: readonly PriorityLabel[];
    readonly flaky?: boolean;
    readonly factorsUnavailableAny?: readonly FactorKey[];
  };
  readonly action: RoutingAction;
}

/** §4.1 alert-fatigue configuration. */
export interface FatigueConfig {
  /** Max DECIDED/CLAIMED reviews before low-severity items defer a day. */
  readonly dailyReviewBudget: number;
  /** Bucket size (days) for the inflation monitor. */
  readonly inflationWindowDays: number;
  /** Mean-priority ratio (this week / previous week) that triggers an alert. */
  readonly inflationAlertRatio: number;
}

/** A versioned, ordered rule set plus its fatigue config. */
export interface AttentionPolicy {
  readonly version: number;
  readonly rules: readonly AttentionPolicyRule[];
  readonly fatigue: FatigueConfig;
}

/** The Phase-1 policy (day-19 §2.1). */
export const ATTENTION_POLICY_V1: AttentionPolicy = {
  version: 1,
  rules: [
    { id: 'r1-critical', when: { labels: ['CRITICAL'] }, action: 'ESCALATE' },
    { id: 'r2-high', when: { labels: ['HIGH'] }, action: 'REVIEW_REQUIRED' },
    { id: 'r3-flaky', when: { flaky: true }, action: 'REVIEW_REQUIRED' },
    { id: 'r4-medium', when: { labels: ['MEDIUM'] }, action: 'REVIEW_RECOMMENDED' },
    { id: 'r5-low', when: { labels: ['LOW'] }, action: 'AUTO_APPROVABLE' },
  ],
  fatigue: { dailyReviewBudget: 20, inflationWindowDays: 7, inflationAlertRatio: 1.5 },
};

/** Fallback when no rule matches: fail toward human attention, never away. */
export const DEFAULT_RULE: AttentionPolicyRule = {
  id: 'default-review-required',
  when: {},
  action: 'REVIEW_REQUIRED',
};

/** Does every present `when` condition hold for `input`? */
function matches(rule: AttentionPolicyRule, input: RoutingInput): boolean {
  const { when } = rule;
  if (when.labels !== undefined && !when.labels.includes(input.label)) {
    return false;
  }
  if (when.minPriority !== undefined && input.combinedPriority < when.minPriority) {
    return false;
  }
  if (when.flaky !== undefined && input.flaky !== when.flaky) {
    return false;
  }
  if (
    when.factorsUnavailableAny !== undefined &&
    !when.factorsUnavailableAny.some((factor) => input.factorsUnavailable.includes(factor))
  ) {
    return false;
  }
  return true;
}

/**
 * Return the first rule whose conditions all match `input`, in declared order,
 * or {@link DEFAULT_RULE} when none does.
 */
export function matchRule(policy: AttentionPolicy, input: RoutingInput): AttentionPolicyRule {
  for (const rule of policy.rules) {
    if (matches(rule, input)) {
      return rule;
    }
  }
  return DEFAULT_RULE;
}
