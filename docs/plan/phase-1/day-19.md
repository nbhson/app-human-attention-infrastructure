# Day 19 — AttentionPolicy rules + routing (REVIEW_REQUIRED vs AUTO_APPROVABLE)

| | |
|---|---|
| **Week** | W3 — Trust pipeline |
| **Spec refs** | Spec 6 §4 (routing/policy), Spec 1 §7 (closed decision set) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 18 (`AttentionScore` + labels) |

---

## 1. Objectives

- Implement the `AttentionPolicy` rule engine that maps an `AttentionAssessment` to a routing decision.
- Route reviews into `REVIEW_REQUIRED` (must reach a human) vs `AUTO_APPROVABLE` (eligible for auto-approve — still gated and sampled, never silently skipped).
- Make every rule explicit, overridable, and auditable; emit `attention.item_routed`.
- Keep the human decision in charge: routing only *prioritizes* and *flags*; it never records the decision itself.

## 2. Design Decisions

- Rules are declarative predicates over the score + evidence, evaluated in order with an explicit `ruleId` and reason recorded.

```ts
export interface AttentionPolicyRule {
  readonly ruleId: string;                       // 'hard-blocker' | 'verify-failed' | ...
  readonly evaluate(a: AttentionAssessment, ctx: PolicyContext): Decision | null;
}
export type RoutingDecision =
  | { route: 'REVIEW_REQUIRED'; reason: string }
  | { route: 'AUTO_APPROVABLE'; reason: string };
```

- `AUTO_APPROVABLE` is **not** auto-approval: it only marks an item as eligible for the gated, sampled auto-approve path (Phase 2). In Phase 1, routing surfaces the label while every item still reaches a human — the `AUTO_APPROVED` decision value exists in the closed set but is not machine-issued yet.
- Hard blockers (CRITICAL finding, failed/timed-out verification, no evidence) always force `REVIEW_REQUIRED`.

## 3. Tasks

### 3.1 Rule engine (150 min)
- [ ] `policy/rules.ts` — hard-blocker, verify-failed, low-confidence, clean-approve rules
- [ ] `policy/policy-engine.ts` — ordered evaluation → routing decision

### 3.2 Routing + events (120 min)
- [ ] Emit `attention.item_routed` with `route` + `ruleId` + `reason`
- [ ] Route result persisted on the review(s) and available to the queue

### 3.3 Tests (90 min)
- [ ] Each rule fires/holds; hard-blockers dominate; `AUTO_APPROVABLE` only when every guard passes

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/attention-engine/src/policy/rules.ts` | Rule predicates |
| `packages/attention-engine/src/policy/policy-engine.ts` | Routing engine |
| `packages/attention-engine/src/routing.ts` | `RoutingDecision` + events |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/attention-engine test` passes
- [ ] CRITICAL finding → `REVIEW_REQUIRED`; failed verification → `REVIEW_REQUIRED`
- [ ] Clean `APPROVE` + passing evidence + low score → `AUTO_APPROVABLE` (label only)
- [ ] `attention.item_routed` records which rule decided, with `correlation_id`

## 6. Notes & Pitfalls

- Distinguish routing from deciding: `AUTO_APPROVABLE` is eligibility, not the `AUTO_APPROVED` decision — the latter stays a Phase-2 sampled, audited path.
- Rules must be pure and side-effect-free; only the policy engine emits/records.

---

*Next: [Day 20 — Context Engine: collect → rank → budget (for the reviewer)](day-20.md)*