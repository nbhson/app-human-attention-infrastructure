# Day 21 — Multi-agent Primitives: MapReduce / Critique-Revision / Ensemble

| | |
|---|---|
| **Week** | 5 — Multi-agent, bounded |
| **Spec refs** | Spec 3 §4 (agent types), §14 (bounded execution), Spec 2 §10 (Planner as internal agent) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 20 (Week 4 checkpoint — hybrid default clean + correct) |

---

## 1. Objectives

By end of day you will have:

1. A new package `packages/multi-agent` (`@harness/multi-agent`) with **three orchestration primitives**: `MapReduce`, `CritiqueRevision`, and `Ensemble`.
2. Each primitive expressed as a **composition over `IAgentRuntime`** — the multi-agent package orchestrates *runs*, it does not re-implement the ReAct loop.
3. A **bounded harness** around every primitive (max steps, token budget, time budget) — the guardrail fabric that Day 22 hardens into standalone loops.
4. Wheel-proven invariants: multi-agent output is still **AI execution, not authority** — a human gate never gets bypassed by these primitives.

This is the "coordination patterns" day; Day 22 makes them autonomously loopable *safely*.

---

## 2. Design Decisions

### 2.1 Primitives compose runs, don't own the loop

```typescript
// packages/multi-agent/src/primitives.ts
export interface MultiAgentPrimitive {
  run(input: PrimitiveInput): Promise<PrimitiveResult>;
}

export interface PrimitiveInput {
  taskId: string;
  context: string;               // ContextSnapshot content (from Context Engine)
  subTasks?: string[];           // for MapReduce
  allowedTools: string[];
  budget: Budget;                // enforced by the runtime (Day 22 hardens)
}

export interface PrimitiveResult {
  outputs: AgentOutput[];        // each produced by a distinct agent run
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  trajectoryRefs: string[];      // run ids — the audit trail
}
```

- `MapReduce`: fan out one run per sub-task (map), then one run to reduce/merge (reduce).
- `CritiqueRevision`: a Critic role reviews a Producer role's output; the Producer revises. Bounded to N revision rounds.
- `Ensemble`: K independent runs on the same task; a selector (rule-based vote / diff-minimization) picks the final candidate.

Each primitive is a *state machine over `IAgentRuntime.executeTask` calls*, not new agent code.

### 2.2 Budget object (seed of Day 22's guardrails)

```typescript
export interface Budget {
  maxIterations: number;        // per primitive
  maxTokens: number;            // across all constituent runs
  maxWallMs: number;            // hard timeout
}
```

Every primitive calls `executeTask` with `maxSteps` derived from its budget; no primitive may spawn an unbounded loop (Day 22 formalizes `BoundedLoop`).

### 2.3 Critique-Revision is evidence-fed, not vibe-fed

The Critic's *input* is the Producer's trajectory + verification evidence, never a bare "looks good?" prompt. Critique output is stored as a distinct review artifact (trajectory-visible). The Critic **never** flips the human APPROVE/REJECT gate — it only revises AI output before verification.

```text
Producer.run → output O
   → Critic.run(input = O + trajectory(O) + verification(O)) → critique C
   → Producer.run(input = O + C) → revised O'
   → (repeat ≤ N rounds)
```

### 2.4 Ensemble selection is mechanical

The ensemble selector is deterministic: prefer the output that produces the fewest/clearest diff, or a rule-based vote on structured outputs. **No LLM decides the ensemble winner** — an LLM selector would reintroduce authority-by-AI at the exact seam where impartiality matters most.

### 2.5 Package boundary + wiring

`@harness/multi-agent` imports `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di`, and **`@harness/agent-runtime`'s `IAgentRuntime` interface only** (not the concrete runtime, and not via a hard import of another engine's internals — `IAgentRuntime` lives in `@harness/domain` or a shared contract). Wire via DI. Emits `multi_agent.primitive_completed { primitive, taskId, runIds, status }`.

---

## 3. Tasks

### 3.1 Scaffold `packages/multi-agent` (30 min)

- [ ] `package.json` (deps: `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di`), `tsconfig.json`, barrel.
- [ ] Add to boundary config + architecture test.

### 3.2 `MapReduce` (90 min)

- [ ] Fan-out sub-task runs in parallel (bounded concurrency), then a reduce run; collect `PrimitiveResult`.
- [ ] Tests: split-merge on a mock multi-file task; parallel map runs; reduce consumes all map outputs.

### 3.3 `CritiqueRevision` (120 min)

- [ ] Producer → Critic → Producer loop (≤ N rounds); critique stored as an artifact; evidence-fed input (§2.3).
- [ ] Tests: a MockLLM critic returns a fixable critique; loop stops at improvement or N rounds; critique is trajectory-visible.

### 3.4 `Ensemble` (90 min)

- [ ] K independent runs + mechanical selector (§2.4).
- [ ] Tests: 3 runs, selector picks the minimal-diff output deterministically; no LLM in selection.

### 3.5 Budget plumbing + event (60 min)

- [ ] Thread `Budget` through all primitives; enforce `maxIterations`/`maxTokens`/`maxWallMs`.
- [ ] Emit `multi_agent.primitive_completed` with run ids.

### 3.6 Boundary + integration tests (75 min)

- [ ] Boundary: `@harness/multi-agent` imports only allowed packages + `IAgentRuntime` contract.
- [ ] Integration: a Crit-Revision then Verification pipeline uses the human gate exactly once (no auto-approve).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/multi-agent/package.json` + `tsconfig.json` + barrel | New package |
| `packages/multi-agent/src/primitives.ts` | `MapReduce`, `CritiqueRevision`, `Ensemble` |
| `packages/multi-agent/src/budget.ts` | `Budget` type + enforcement |
| `packages/multi-agent/src/__tests__/*.test.ts` | Primitive + boundary tests |
| `apps/api/src/bootstrap.ts` (updated) | Multi-agent primitives registration |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/multi-agent test` — all tests pass.
- [ ] `MapReduce` fans out parallel sub-task runs and reduces; `PrimitiveResult` carries all run ids.
- [ ] `CritiqueRevision` runs Producer→Critic→Producer with the critique stored as an artifact; bounded to N rounds.
- [ ] `Ensemble` selects the winner mechanically (no LLM selector).
- [ ] Every primitive respects `Budget` (iterations, tokens, wall-clock) and cannot loop unbounded.
- [ ] Multi-agent output never bypasses the human APPROVE/REJECT gate (integration test proves the gate still fires after a primitive run).
- [ ] `multi_agent.primitive_completed` event emitted with run ids + status.
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **Primitives orchestrate runs; they are not agents.** If you find yourself editing the ReAct loop to "support" a primitive, that's the wrong boundary — the loop belongs to the runtime (Spec 3), the composition belongs here.
- **Critique is evidence, not authority.** The Critic revises AI *output*; it does not approve AI *work*. Never route a CritiqueRevision "success" around the Attention Engine + human gate.
- **Ensemble must not use an LLM to pick the winner.** An LLM selector is the AI arbitrating its own correctness — the same failure mode as "AI verifies AI." Mechanical selection only.
- **Budgets are the load-bearing feature.** Today's `Budget` object is a seed; Day 22 turns it into enforced loop ceilings. Do not leave any primitive with a path that ignores `maxIterations`/`maxTokens`.
- **Run-id audit is the multi-agent provenance.** Multi-agent breaks one task into many runs; without `trajectoryRefs` on every result, the provenance chain splinters. Trace every constituent run.
- **Tomorrow (Day 22):** bounded autonomous loops — max iterations, token budget, guardrails.

---

*Prev: [Day 20 — Week 4 Checkpoint: Lost-in-middle + Freshness Under Hybrid; Clean Cutover](day-20.md) | Next: [Day 22 — Bounded Autonomous Loops: Max Iterations, Token Budget, Guardrails](day-22.md)*
