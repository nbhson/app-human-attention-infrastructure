# Day 24 — Decomposer: 3-Level Hierarchical Planning, Plan-and-Solve/ReWOO, Dynamic Replanning

| | |
|---|---|
| **Week** | 5 — Multi-agent, bounded |
| **Spec refs** | Spec 2 §10 (AI-Driven Decomposition: three-level planning, Plan-and-Solve/ReWOO, dynamic replanning, planning guardrails) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 23 (role taxonomy + output contracts) |

---

## 1. Objectives

By end of day you will have:

1. A **Decomposer** that turns a goal into a plan via **three-level hierarchical planning** — goal → subtasks → atomic tasks (Spec 2 §10).
2. A **Plan-and-Solve / ReWOO** split: "form a plan" is separated from "execute the plan", so a bad decomposition fails *cheaply before any step runs*.
3. **Dynamic replanning**: on REWORK, the planner re-runs with the failure evidence as input.
4. **Planning guardrails** (Spec 2 §10 "10 Commandments"): a generated plan must be definite, bounded, conservative — else it escalates to a human instead of auto-executing.

The Decomposer is the Phase-1 "Planner becomes an internal AI Agent itself" seam, now built with the same evidence-before-confidence discipline as any agent.

---

## 2. Design Decisions

### 2.1 Three-level plan model

```typescript
// packages/multi-agent/src/decomposer.ts
export interface Plan {
  id: PlanId;
  goal: string;                 // Level 0 — the developer's request
  subtasks: SubTask[];          // Level 1 — decomposed goals
  atomicTasks: AtomicTask[];    // Level 2 — testable units that enter the DAG
  revision: number;             // dynamic replanning counter
}

export interface AtomicTask {
  id: string;
  description: string;          // specific, testable
  dependsOn: string[];          // DAG edges (Spec 2 §4.4)
  outputSchema: unknown;        // what it produces
  verificationHint: string;     // how this atomic task is verified (evidence)
}
```

**Only atomic tasks enter the workflow DAG** (Spec 2 §10). The goal and subtasks are planning scaffolding; the DAG is the execution unit.

### 2.2 Plan-and-Solve / ReWOO separation

```text
PLAN phase (cheap, no tools):  LLM(goal + context) → Plan { subtasks, atomicTasks }
SOLVE phase (expensive):        each atomic task → existing task/agent/verify pipeline
```

- The PLAN phase uses the `ORCHESTRATOR` role from Day 23 (plan-only, no write tools).
- A plan that fails guardrail validation **never reaches SOLVE**. It escalates to a human — this is the "fail cheaply" property.

### 2.3 Dynamic replanning (REWORK → replan with evidence)

On a task REWORK, the Decomposer re-runs with the failed task's evidence (verification report + trajectory) as input:

```typescript
async replan(originalPlan: Plan, failedEvidence: Evidence[]): Promise<Plan> {
  // same PLAN phase, but the prompt now includes "subtask X failed because <evidence>"
  // revision + 1; only the affected subtask branch is re-decomposed (not the whole goal)
}
```

Replanning is **bounded** (≤ `revisionLimit`, default 2) and, like execution, subject to Day 22's loop ceilings.

### 2.4 Planning guardrails (validate before DAG)

From Spec 2 §10 ("definite, bounded, conservative"):

| Guardrail | Check |
|-----------|-------|
| Testable units | every atomic task has a `verificationHint` (evidence-producible) |
| No invented steps | every atomic task references evidence/context, not vibes |
| Bounded scope | atomic count ≤ `maxAtomicTasks` (default 12); plan depth bounded |
| Conservative | plan does not over-engineer ("stop rather than over-engineer") |
| Legal DAG | `dependsOn` references existing ids; no cycles |

```typescript
function validatePlan(plan: Plan): GuardrailReport {
  // returns { valid: boolean, violations: string[] }
}
```

Any violation → `plan.escalated_to_human` (the plan is shown, not auto-executed).

### 2.5 Decomposer is bounded + role-gated

The Decomposer runs the `ORCHESTRATOR` role (plan-only) inside a `BoundedLoop` (Day 22). The plan is *produced* by AI but *owned* by the orchestrator state machine — the plan becomes a Workflow only after the guardrails and (when flagged) human sign-off.

---

## 3. Tasks

### 3.1 `Plan` model + schema (60 min)

- [ ] `packages/multi-agent/src/decomposer.ts` — `Plan`, `SubTask`, `AtomicTask` (§2.1).
- [ ] `packages/db/src/schema/plans.ts` — persist plans + revisions (migration).

### 3.2 PLAN phase (LLM, ORCHESTRATOR role) (90 min)

- [ ] `planPhase(goal, context)` — calls LLMProvider as plan-only role, returns structured `Plan` (MockLLM in tests).
- [ ] Separate from SOLVE (no tools in PLAN).

### 3.3 Guardrail validation (90 min)

- [ ] `validatePlan()` (§2.4) with all five checks.
- [ ] Tests: over-bounded plan, un-testable unit, invented step, cyclic `dependsOn` → each rejected.

### 3.4 SOLVE wiring + atomic→task mapping (120 min)

- [ ] Map validated `atomicTasks` → workflow DAG (via orchestrator `createWorkflow`); only atomic tasks enter.
- [ ] Reuse existing task pipeline (Context → Agent → Verify) per atomic task.

### 3.5 Dynamic replanning (90 min)

- [ ] `replan(originalPlan, failedEvidence)` (§2.3); revision counter; branch-only re-decompose.
- [ ] Tests: REWORK triggers replan; revision cap enforced; failure evidence present in the replan prompt.

### 3.6 Escalation tests (60 min)

- [ ] Guardrail-violating plan escalates (`plan.escalated_to_human`), never auto-executes.
- [ ] Integration: goal → plan → validate → DAG → execute one atomic task end-to-end.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/multi-agent/src/decomposer.ts` | `Decomposer`, `Plan`, guardrails, replan |
| `packages/db/src/schema/plans.ts` + migration | Plans persisted |
| `packages/multi-agent/src/__tests__/decomposer.test.ts` | Planning/guardrail/replan tests |
| `apps/api/src/bootstrap.ts` (updated) | Decomposer registration |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/multi-agent test` — all tests pass.
- [ ] A goal decomposes into subtasks → atomic tasks; **only atomic tasks enter the workflow DAG**.
- [ ] PLAN and SOLVE are separated (PLAN has no write tools; a bad plan fails before any step runs).
- [ ] Guardrails reject: un-testable units, invented steps, over-bounded plans, cyclic DAGs — each escalates to human.
- [ ] REWORK re-runs the planner with failure evidence; branch-only re-decompose; revision ≤ cap.
- [ ] The Decomposer runs the ORCHESTRATOR role inside a `BoundedLoop`.
- [ ] `plan.escalated_to_human` emitted (never auto-executed) for guardrail violations.
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **The plan is a proposal, not a verdict.** Spec 2 §10 is emphatic: the planner produces a plan that "must pass checks before it becomes a Workflow." A decomposed DAG that skips guardrail validation is the same class of failure as an unverified code change.
- **Atomic = testable.** If an atomic task has no `verificationHint`, it cannot be verified, and the whole "evidence before confidence" chain breaks at the planning level. Make this a hard guardrail.
- **Replan only the affected branch.** Re-decomposing the whole goal on a single-task REWORK discards good prior work and re-burns budget. Scoped replanning is the point of hierarchical decomposition.
- **ReWOO separation is cheap insurance.** If PLAN and SOLVE are fused, a bad plan only surfaces as *wasted execution*. The split lets a bad plan die for the cost of a single LLM call.
- **Guardrail escalation is a human decision point.** Show the plan (and the violated guardrails) to a human; do not auto-fix the plan by silently relaxing a guardrail.
- **Tomorrow (Day 25):** Week 5 checkpoint — multi-agent demo + guardrail proofs.

---

*Prev: [Day 23 — Role Taxonomy: Coder/Reviewer/Tester/Orchestrator (AI Review Augments, Never Replaces)](day-23.md) | Next: [Day 25 — Week 5 Checkpoint: Multi-agent Demo + Guardrail Proofs](day-25.md)*
