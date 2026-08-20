# Day 23 — Role Taxonomy: Coder/Reviewer/Tester/Orchestrator (AI Review Augments, Never Replaces)

| | |
|---|---|
| **Week** | 5 — Multi-agent, bounded |
| **Spec refs** | Spec 3 §4 (agent types), §14.1 (tool permission tiers), Spec 6 §4.1 (feedback loop), Architecture §4.2 (AI not authority) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 22 (bounded autonomous loops + runaway guards) |

---

## 1. Objectives

By end of day you will have:

1. A **role taxonomy** in `@harness/multi-agent`: `Coder`, `Reviewer`, `Tester`, `Orchestrator` — each a distinct tool-tier, prompt-profile, and output contract.
2. **Role→tool permission tiers** enforced by the runtime (Spec 3 §14.1): a Reviewer cannot write; a Tester cannot merge; an Orchestrator cannot decide.
3. The explicit invariant in code + tests: **AI Review augments Verification/Attention; it never replaces the human APPROVE/REJECT gate.**
4. Role output-typed as *signals* (critique, test results, plan), not *decisions*.

This is the governance surface of the multi-agent week — roles define *what* an AI role is allowed to do, and just as importantly what it never is.

---

## 2. Design Decisions

### 2.1 Role definition

```typescript
// packages/multi-agent/src/roles.ts
export type AgentRole = 'CODER' | 'REVIEWER' | 'TESTER' | 'ORCHESTRATOR';

export interface RoleSpec {
  role: AgentRole;
  allowedTools: string[];        // maps to runtime tool tiers (Spec 3 §14.1)
  forbid: string[];              // explicitly forbidden tools
  outputContract: RoleOutput;    // 'code' | 'critique' | 'test_result' | 'plan'
  maxTier: 'public' | 'standard' | 'elevated' | 'admin';
}

export const ROLES: Record<AgentRole, RoleSpec> = {
  CODER:         { allowedTools: ['read_file','write_file','patch_file','search_code'], forbid: ['git_push','run_full_suite'], outputContract: 'code',          maxTier: 'standard' },
  REVIEWER:      { allowedTools: ['read_file','search_symbol','git_log'],              forbid: ['write_file','patch_file','git_push'],   outputContract: 'critique',      maxTier: 'public' },
  TESTER:        { allowedTools: ['read_file','write_file','run_test'],                forbid: ['git_push','delete_branch'],           outputContract: 'test_result',   maxTier: 'standard' },
  ORCHESTRATOR:  { allowedTools: ['read_file','search_code','plan'],                   forbid: ['write_file','patch_file','git_push','run_test'], outputContract: 'plan', maxTier: 'public' },
};
```

### 2.2 Roles are permissions + contracts, not personalities

A "role" is **not a different system prompt with a name**. It is:
1. A **tool-tier ceiling** (the runtime enforces tier, Spec 3 §14.1).
2. An **output contract** the result must satisfy (validated on completion).
3. A **forbid list** that is checked *before* dispatch, not *after* a violation.

The system prompt differs per role, but that's a *surface*; the tier + contract are the *governance*. Do not reduce roles to prompt templates.

### 2.3 Output contract validation

Each role's result is validated against its contract before it is accepted downstream:

```typescript
function validateOutput(role: AgentRole, out: AgentOutput): void {
  // CODER → must produce artifacts (file diffs), not verdicts
  // REVIEWER → must produce a structured critique { findings: [...], severity } — NOT 'APPROVE'/'REJECT'
  // TESTER → must produce test results, not edits to source
  // ORCHESTRATOR → must produce a plan, not executed changes
}
```

A `REVIEWER` whose output contains an `APPROVE`/`REJECT` verdict is **rejected** — that is the precise line where AI review would replace the human gate.

### 2.4 The augmentation invariant, encoded

The AI `REVIEWER` role is an *input* to the human reviewer, surfaced alongside Verification/Attention signals:

```text
VerificationEngine (mechanical) ─┐
AttentionEngine   (scoring)     ─┼─→ Review Queue (human decides APPROVE/REJECT)
AI Reviewer role  (critique)    ─┘   ← advisory only, never the decision
```

Tests assert: (a) a Reviewer output carries no decision field; (b) a `review.decision_submitted` event has `triggered_by: 'human'` always (never `'agent'`); (c) `AUTO_APPROVABLE` remains the only auto-path (sampling-audited), untouched.

### 2.5 Orchestrator role = plan-only

The `ORCHESTRATOR` role produces *plans* (decomposition — Day 24), never executes changes. Its output is consumed by the human/orchestrator state machine, which owns execution. This enshrines Spec 2 §10's "the plan must pass checks before it becomes a Workflow."

---

## 3. Tasks

### 3.1 `roles.ts` + role specs (60 min)

- [ ] `packages/multi-agent/src/roles.ts` (§2.1) — `ROLES`, `AgentRole`, `RoleSpec`.
- [ ] Unit tests: each role's `forbid` and `maxTier` are non-empty and consistent (CODER can write, REVIEWER cannot, etc.).

### 3.2 Dispatch-time role enforcement (90 min)

- [ ] A `RoleGuard` in the multi-agent package resolves the role spec and passes `allowedTools` + `maxTier` to the runtime execute call (Spec 3 §14.1 tier).
- [ ] Test: dispatching a REVIEWER with `write_file` is rejected pre-execution.

### 3.3 Output contract validation (75 min)

- [ ] `validateOutput(role, out)` (§2.3); a REVIEWER verdict-bearing output is rejected.
- [ ] Tests per role: valid + invalid outputs.

### 3.4 Augmentation wiring in the review path (90 min)

- [ ] Surface the AI Reviewer critique as an *advisory* source in the review queue (alongside verification/attention), never as a decision.
- [ ] Assert `review.decision_submitted` carries `triggered_by: 'human'` in integration tests; `AUTO_APPROVABLE` unchanged.

### 3.5 Tests + boundary (105 min)

- [ ] End-to-end: Coder → Tester → (AI) Reviewer critique → human approve. Assert the human gate fired exactly once and no role auto-decided.
- [ ] Boundary test on `@harness/multi-agent`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/multi-agent/src/roles.ts` | `AgentRole`, `RoleSpec`, `ROLES` |
| `packages/multi-agent/src/role-guard.ts` | Dispatch-time role/tool-tier enforcement |
| `packages/multi-agent/src/output-contract.ts` | Output contract validation |
| `packages/agent-runtime` (no change) / review adapter | AI critique surfaced as advisory source |
| `packages/multi-agent/src/__tests__/roles.test.ts` | Role/bypass/contract tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/multi-agent test` — all tests pass.
- [ ] Four roles defined with tool-tier ceilings + forbid lists (REVIEWER cannot write, ORCHESTRATOR cannot execute, etc.).
- [ ] A REVIEWER output bearing an APPROVE/REJECT verdict is rejected (contract violation).
- [ ] Dispatch of a role with a forbidden tool is rejected *before* execution (not after).
- [ ] AI Reviewer critique reaches the review queue as an advisory signal only.
- [ ] `review.decision_submitted` is always `triggered_by: 'human'`; `AUTO_APPROVABLE` remains the only auto-path.
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **A role is not a prompt.** If your only artifact is four system-prompt strings, you've built personas, not governance. The tier + forbid list + output contract are what make roles *safe*; the prompt is secondary.
- **The Reviewer's forbidden output is `APPROVE`/`REJECT`.** That single distinction is the whole "AI review augments, never replaces" rule in executable form. Enforce it at the contract layer, not in a comment.
- **Enforce before dispatch, not after.** A role that calls a forbidden tool and is *then* caught has already acted. The `RoleGuard` must run at dispatch time (Spec 3 §14.1: tier is a registry property).
- **Orchestrator plans, never executes.** The decomposition (Day 24) is a *plan* that passes checks before becoming a workflow. If the ORCHESTRATOR role can also write files, the separation between planning and execution dissolves.
- **Advisory = no decision field, ever.** The AI critique may say "this looks risky," but it must not produce a verdict field. Model it as structured findings, and let the human (or the Attention/Verification rules) decide.
- **Tomorrow (Day 24):** Decomposer — 3-level hierarchical planning, Plan-and-Solve/ReWOO, dynamic replanning (Spec 2 §10).

---

*Prev: [Day 22 — Bounded Autonomous Loops: Max Iterations, Token Budget, Guardrails](day-22.md) | Next: [Day 24 — Decomposer: 3-Level Hierarchical Planning, Plan-and-Solve/ReWOO, Dynamic Replanning](day-24.md)*
