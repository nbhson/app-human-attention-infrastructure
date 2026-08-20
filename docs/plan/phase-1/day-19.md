# Day 19 — AttentionPolicy Rules, Routing & Alert Fatigue

| | |
|---|---|
| **Week** | 3 — Trust Pipeline |
| **Spec refs** | Spec 6 §4 (Policy & Routing), §4.1 (Alert Fatigue — added in spec fix) |
| **Estimated effort** | 6 h |
| **Prerequisites** | Day 18 (`attention.assessment_created`, assessments table) |

---

## 1. Objectives

1. Implement **AttentionPolicy**: versioned, data-driven rules mapping assessments → routing decisions (`REVIEW_REQUIRED`, `REVIEW_RECOMMENDED`, `AUTO_APPROVABLE`, `ESCALATE`).
2. Build the **routing service**: consumes `attention.assessment_created`, applies policy, enqueues into `review_queue` (schema today; API on Day 22).
3. Implement the spec-fix **§4.1 alert-fatigue controls**: daily review budget, adaptive thresholds, priority-inflation monitoring, `reportAssessmentFeedback`.
4. Policy decisions are **append-only and explainable**: every routing row stores rule id, policy version, and the assessment snapshot used.

> **Why this matters:** scoring (Day 18) says *how urgent*; policy says *what to do about it* — including the discipline to not drown reviewers in CRITICALs, because a harness that trains humans to ignore its alerts is worse than no harness.

---

## 2. Design Decisions

### 2.1 Policy model (data, not code)

```ts
// packages/attention-engine/src/policy.ts
export type RoutingAction = 'REVIEW_REQUIRED' | 'REVIEW_RECOMMENDED' | 'AUTO_APPROVABLE' | 'ESCALATE';

export interface AttentionPolicyRule {
  id: string;
  when: { minPriority?: number; labels?: string[]; flaky?: boolean; factorsUnavailableAny?: string[] };
  action: RoutingAction;
}

export const ATTENTION_POLICY_V1 = {
  version: 1,
  rules: [
    { id: 'r1-critical', when: { labels: ['CRITICAL'] }, action: 'ESCALATE' },
    { id: 'r2-high',     when: { labels: ['HIGH'] },     action: 'REVIEW_REQUIRED' },
    { id: 'r3-flaky',    when: { flaky: true },          action: 'REVIEW_REQUIRED' },   // flaky always reviewed
    { id: 'r4-medium',   when: { labels: ['MEDIUM'] },   action: 'REVIEW_RECOMMENDED' },
    { id: 'r5-low',      when: { labels: ['LOW'] },      action: 'AUTO_APPROVABLE' },
  ] satisfies AttentionPolicyRule[],
  // §4.1 alert fatigue config
  fatigue: { dailyReviewBudget: 20, inflationWindowDays: 7, inflationAlertRatio: 1.5 },
};
```

Evaluation: first matching rule wins, in declared order (r3 after r2 means a CRITICAL flaky still ESCALATEs — order is part of the policy and unit-tested).

### 2.2 Routing + queue (migration `0019_routing.sql`)

```sql
CREATE TABLE review_queue (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  assessment_id   TEXT NOT NULL REFERENCES attention_assessments(id),
  action          TEXT NOT NULL CHECK (action IN
    ('REVIEW_REQUIRED','REVIEW_RECOMMENDED','AUTO_APPROVABLE','ESCALATE')),
  policy_version  INTEGER NOT NULL,
  rule_id         TEXT NOT NULL,
  position        INTEGER NOT NULL,            -- queue ordering: priority desc, then FIFO
  status          TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','CLAIMED','DECIDED','DROPPED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assessment_feedback (           -- §4.1 feedback loop
  id              TEXT PRIMARY KEY,
  assessment_id   TEXT NOT NULL REFERENCES attention_assessments(id),
  was_useful      BOOLEAN NOT NULL,          -- did the reviewer agree with the priority?
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`AUTO_APPROVABLE` rows enter the queue flagged, **not** auto-approved — Phase 1 has no auto-approval path; the flag exists so a future phase can flip it without schema change. (State machine has no auto-approve transition; day-06 table is unchanged.)

### 2.3 §4.1 Alert-fatigue mechanisms

| Mechanism | Implementation |
|---|---|
| **Daily review budget** | Count `DECIDED`+`CLAIMED` rows today; when budget exhausted, `REVIEW_RECOMMENDED`/`AUTO_APPROVABLE` items are deferred to tomorrow's queue (status stays QUEUED, position recomputed at midnight job — Phase 1: on next routing pass). ESCALATE/REVIEW_REQUIRED never deferred. |
| **Adaptive thresholds** | Nightly-ish (on-demand Phase 1) recompute: if >80% of last week's HIGH items got `was_useful=false` feedback, raise HIGH threshold by +0.05 (bounded [0.60, 0.80]); log adjustment as event `attention.threshold_adjusted`. |
| **Priority-inflation monitoring** | Weekly ratio = mean(combined_priority this week) / mean(previous week); if > `inflationAlertRatio`, emit `attention.inflation_detected` + log warning (observability Day 27 picks it up). |
| **`reportAssessmentFeedback`** | Public engine method; called by Day-22 API when reviewer submits a decision ("was this item worth your attention?"). Stored in `assessment_feedback`; consumed by adaptive thresholds. |

```ts
export class AttentionRouter {
  async route(assessment: AttentionAssessment): Promise<void> {
    const rule = matchRule(ATTENTION_POLICY_V1, assessment);
    const action = await this.applyFatigueControls(rule.action, assessment);
    await this.db.insertInto('review_queue').values({
      /* ..., action, policy_version: ATTENTION_POLICY_V1.version, rule_id: rule.id,
         position: nextPosition(assessment.combinedPriority) */
    }).execute();
    this.bus.publish(makeEvent('attention.item_routed', { /* queue id, action */ }));
  }
}
```

---

## 3. Tasks

- [ ] **3.1** Migration `0019_routing.sql` (review_queue + assessment_feedback). (45 min)
- [ ] **3.2** `ATTENTION_POLICY_V1` + pure `matchRule` + ordering unit tests. (1 h)
- [ ] **3.3** `AttentionRouter` subscribed to `attention.assessment_created`; queue insert + `attention.item_routed`. (1 h)
- [ ] **3.4** Fatigue controls: budget counter + deferral, adaptive-threshold function, inflation monitor (pure functions + a manual-trigger service method). (1.5 h)
- [ ] **3.5** `reportAssessmentFeedback` method + storage. (30 min)
- [ ] **3.6** Tests: rule precedence; budget exhaustion defers RECOMMENDED but not ESCALATE; threshold adjustment bounds; inflation ratio emits event; feedback round-trip. (1.5 h)

---

## 4. Deliverables

| File | Description |
|---|---|
| `packages/attention-engine/src/policy.ts` | ATTENTION_POLICY_V1 + matchRule |
| `packages/attention-engine/src/router.ts` | AttentionRouter + fatigue controls |
| `packages/attention-engine/migrations/0019_routing.sql` | review_queue + assessment_feedback |

---

## 5. Acceptance Criteria

- [ ] CRITICAL → ESCALATE, HIGH → REVIEW_REQUIRED, flaky any-label → REVIEW_REQUIRED (rule precedence test), MEDIUM → REVIEW_RECOMMENDED, LOW → AUTO_APPROVABLE.
- [ ] Every queue row carries `policy_version` + `rule_id` + assessment snapshot (explainability).
- [ ] Budget exhausted → RECOMMENDED deferred, ESCALATE/REQUIRED still enqueued immediately.
- [ ] Adaptive threshold never leaves [0.60, 0.80]; adjustment emits `attention.threshold_adjusted`.
- [ ] Inflation monitor emits `attention.inflation_detected` when ratio exceeded.
- [ ] `pnpm test && pnpm lint` green; boundary tests green.

---

## 6. Notes & Pitfalls

- **No auto-approve in Phase 1** — the AUTO_APPROVABLE flag is a routing hint for the queue UI, nothing more. Resist wiring it to task transitions; that requires new state-machine transitions (Spec 2) and is a Phase-2 decision.
- **Budget counting must be timezone-explicit** (UTC day boundaries — everything in this system is UTC; don't let local midnight leak in).
- **Deferral vs dropping:** deferred items stay QUEUED; never silently DROP — a DROP requires a human action (Day-22 UI) and is recorded.
- **Policy versioning discipline:** any rule change bumps `version`; old queue rows keep their version so audits can explain *why* an item was routed as it was.
- **Next:** [Day 20 — Context Engine: Collect, Rank & Budget](day-20.md) starts the last engine; its COLLECT_CONTEXT step is the remaining Day-09 stub.

---

*Prev: [Day 18 — Attention Engine Scoring](day-18.md) | Next: [Day 20 — Context Engine: Collect, Rank & Budget](day-20.md)*
