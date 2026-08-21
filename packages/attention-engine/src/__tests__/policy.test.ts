import { describe, expect, it } from 'vitest';

import { ATTENTION_POLICY_V1, DEFAULT_RULE, matchRule } from '../policy.js';
import type { AttentionPolicy, RoutingInput } from '../policy.js';
import type { FactorKey, PriorityLabel } from '../types.js';

function input(overrides: Partial<RoutingInput> = {}): RoutingInput {
  return {
    label: 'LOW',
    combinedPriority: 0.2,
    flaky: false,
    factorsUnavailable: [],
    ...overrides,
  };
}

describe('matchRule (ATTENTION_POLICY_V1)', () => {
  it('routes CRITICAL → ESCALATE, even when ALSO flaky (order = r1 before r3)', () => {
    expect(matchRule(ATTENTION_POLICY_V1, input({ label: 'CRITICAL', flaky: true }))).toMatchObject(
      {
        id: 'r1-critical',
        action: 'ESCALATE',
      },
    );
  });

  it('routes HIGH → REVIEW_REQUIRED', () => {
    expect(matchRule(ATTENTION_POLICY_V1, input({ label: 'HIGH' }))).toMatchObject({
      id: 'r2-high',
      action: 'REVIEW_REQUIRED',
    });
  });

  it('routes any flaky label → REVIEW_REQUIRED (r3)', () => {
    expect(matchRule(ATTENTION_POLICY_V1, input({ label: 'LOW', flaky: true }))).toMatchObject({
      id: 'r3-flaky',
      action: 'REVIEW_REQUIRED',
    });
  });

  it('routes MEDIUM → REVIEW_RECOMMENDED', () => {
    expect(matchRule(ATTENTION_POLICY_V1, input({ label: 'MEDIUM' }))).toMatchObject({
      id: 'r4-medium',
      action: 'REVIEW_RECOMMENDED',
    });
  });

  it('routes LOW → AUTO_APPROVABLE', () => {
    expect(matchRule(ATTENTION_POLICY_V1, input({ label: 'LOW' }))).toMatchObject({
      id: 'r5-low',
      action: 'AUTO_APPROVABLE',
    });
  });

  it('falls back to a default REVIEW_REQUIRED when nothing matches', () => {
    const policy: AttentionPolicy = {
      version: 9,
      rules: [{ id: 'only-high', when: { labels: ['HIGH'] }, action: 'REVIEW_REQUIRED' }],
      fatigue: ATTENTION_POLICY_V1.fatigue,
    };
    expect(matchRule(policy, input({ label: 'LOW' }))).toBe(DEFAULT_RULE);
  });
});

describe('matchRule condition operators', () => {
  const policy: AttentionPolicy = {
    version: 2,
    rules: [
      {
        id: 'floor',
        when: { minPriority: 0.9 },
        action: 'ESCALATE',
      },
      {
        id: 'missing-factor',
        when: { factorsUnavailableAny: ['risk', 'confidence'] },
        action: 'REVIEW_REQUIRED',
      },
      {
        id: 'flaky-or-nothing',
        when: { flaky: true },
        action: 'REVIEW_RECOMMENDED',
      },
    ],
    fatigue: ATTENTION_POLICY_V1.fatigue,
  };

  it('matches `minPriority` by an inclusive lower bound', () => {
    expect(matchRule(policy, input({ combinedPriority: 0.95 }))).toMatchObject({ id: 'floor' });
    expect(matchRule(policy, input({ flaky: true, combinedPriority: 0.5 }))).toMatchObject({
      id: 'flaky-or-nothing',
    });
  });

  it('matches `factorsUnavailableAny` when ANY listed factor is absent', () => {
    const unavailable: FactorKey[] = ['confidence'];
    expect(matchRule(policy, input({ factorsUnavailable: unavailable }))).toMatchObject({
      id: 'missing-factor',
    });
  });

  it('does not match `factorsUnavailableAny` when none intersect', () => {
    const unavailable: FactorKey[] = ['impact'];
    expect(
      matchRule(policy, input({ label: 'LOW' as PriorityLabel, factorsUnavailable: unavailable })),
    ).toBe(DEFAULT_RULE);
  });
});
