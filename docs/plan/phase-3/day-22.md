# Day 22 — Bounded Autonomous Loops: Max Iterations, Token Budget, Guardrails

| | |
|---|---|
| **Week** | 5 — Multi-agent, bounded |
| **Spec refs** | Spec 3 §14 (token costs, max steps, tool rate limiting), §14.2 (rate limiting), Spec 2 §7 (timeouts, escalation) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 21 (multi-agent primitives + budget seed) |

---

## 1. Objectives

By end of day you will have:

1. A **`BoundedLoop`** abstraction that wraps any multi-agent primitive (or single agent) with hard leases on **iterations, token spend, and wall-clock**.
2. **Guardrails** that trip on approaching limits (warn), on exceeding them (halt + escalate), and on runaway patterns (rate-limit violations, no-progress detection).
3. A **no-progress detector** — repeated near-identical tool calls or outputs trigger escalation rather than silent spinning.
4. Wheel-proven proof: **every** loop path terminates, and a runaway is a *tested failure mode*, not an accepted outcome (README §8: "runaway is a failure mode to test, not a feature to accept").

This turns "bounded" from a named plan item into enforceable runtime behavior.

---

## 2. Design Decisions

### 2.1 The `BoundedLoop` lease model

```typescript
// packages/multi-agent/src/bounded-loop.ts
export interface LoopLease {
  maxIterations: number;      // hard ceiling on loop rounds
  maxTokens: number;          // cumulative token ceiling across all runs
  maxWallMs: number;          // absolute wall-clock deadline
  warnAt: number;             // fraction (e.g. 0.8) to emit a warning event
}

export class BoundedLoop<T> {
  constructor(private readonly lease: LoopLease, private readonly bus: IEventBus) {}

  async run(fn: (ctx: LoopCtx) => Promise<T>): Promise<LoopOutcome<T>> {
    // ctx tracks { iterationsUsed, tokensUsed, startedAt }
    // - before each iteration: check iterations + tokens + wall; if exceeded → ESCALATED
    // - after each iteration: if ctx crossed warnAt → emit loop.near_limit (warn)
    // - on escalation: stop fn, publish loop.escalated, return ESCALATED
  }
}
```

Every primitive from Day 21 is re-expressed as a `BoundedLoop` body. A primitive that doesn't fit the loop is a design bug, not an exception.

### 2.2 Three ceilings, three failure semantics

| Ceiling | Exceeded → | Recoverable? |
|---------|-----------|--------------|
| `maxIterations` | `ESCALATED` → `AWAITING_HUMAN_INTERVENTION` | Human re-queues |
| `maxTokens` | `ESCALATED` (cost ceiling) | Human re-authors budget |
| `maxWallMs` | `ESCALATED` (timeout) | Human retries |

Escalation reuses Spec 2 §7's `AWAITING_HUMAN_INTERVENTION` state and the Phase 1 escalation path — multi-agent loops do **not** invent their own terminal state.

### 2.3 No-progress detector

Runaway isn't only "too many iterations" — it's "iterations that don't move." Track a rolling fingerprint of the last *k* loop outputs (hash of tool-call signature + result):

```typescript
if (lastKOutputs are near-identical) → NO_PROGRESS → escalate early  // don't burn the full token budget
```

This catches ReAct loops that repeat "read file / it's still wrong / read file" without ever hitting `maxIterations`. The fingerprint is content-hash based, stored in-memory per loop (not persisted blob).

### 2.4 Guardrail events (auditable, not silent)

- `loop.near_limit { primitive, ceiling, used, limit }` — warning at `warnAt`.
- `loop.escalated { primitive, ceiling, iterationsUsed, tokensUsed, reason: 'iterations'|'tokens'|'wall'|'no_progress' }`.
- `loop.completed { primitive, iterationsUsed, tokensUsed, wallMs }` — even success is metered.

Every event carries `correlation_id = taskId`. The audit trail must show *why* a loop stopped, not just that it did.

### 2.5 Interaction with tool rate limiting (Spec 3 §14.2)

The runtime's sliding-window tool rate limit (Phase 2) is the *inner* guard; `BoundedLoop` is the *outer* guard. A primitive whose tools are rate-limited should see the runtime return a structured rate-limit observation (Spec 3 §14.2), not hang. The loop treats repeated rate-limit responses as a no-progress signal.

---

## 3. Tasks

### 3.1 `BoundedLoop` + `LoopCtx` (120 min)

- [ ] `packages/multi-agent/src/bounded-loop.ts` — lease, ctx tracking, escalation (§2.1–2.2).
- [ ] Unit tests: iteration ceiling trips at `maxIterations`; token ceiling trips; wall-clock trips (fake timers).

### 3.2 `NoProgressDetector` (90 min)

- [ ] `packages/multi-agent/src/no-progress.ts` — rolling fingerprint over last k outputs.
- [ ] Tests: repeated identical output → `NO_PROGRESS`; varied output → continues.

### 3.3 Rewrap Day 21 primitives as loops (120 min)

- [ ] `MapReduce`/`CritiqueRevision`/`Ensemble` bodies inside `BoundedLoop`; remove per-primitive ad-hoc loops.
- [ ] Tests: each primitive escalates rather than hangs when past its lease.

### 3.4 Guardrail events + escalation wiring (90 min)

- [ ] Emit `loop.near_limit`/`loop.escalated`/`loop.completed` (§2.4).
- [ ] Escalation drives the existing `AWAITING_HUMAN_INTERVENTION` transition (reuse Spec 2 path, not a new state).

### 3.5 Runaway proof test (90 min)

- [ ] A MockLLM that loops forever: assert the loop terminates at the ceiling and escalates (the README's "runaway = tested failure mode").
- [ ] A MockLLM that repeats the same tool call: assert `NO_PROGRESS` escalation fires *before* the full budget is spent.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/multi-agent/src/bounded-loop.ts` | `BoundedLoop`, `LoopCtx`, `LoopLease` |
| `packages/multi-agent/src/no-progress.ts` | `NoProgressDetector` |
| `packages/multi-agent/src/events.ts` | Guardrail event payloads |
| `packages/multi-agent/src/primitives.ts` (updated) | Primitives re-wrapped as loops |
| `packages/multi-agent/src/__tests__/bounded-loop.test.ts` | Ceilings + runaway + no-progress tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/multi-agent test` — all tests pass.
- [ ] Every primitive terminates under `maxIterations`, `maxTokens`, and `maxWallMs` — proven, not assumed.
- [ ] A forever-looping MockLLM is halted and escalated (runaway is a *tested failure mode*).
- [ ] A no-progress loop (repeated identical output) escalates early, before burning the full token budget.
- [ ] `loop.near_limit` / `loop.escalated` / `loop.completed` all emitted with the ceiling + reason.
- [ ] Escalation routes through the existing `AWAITING_HUMAN_INTERVENTION` path (no new terminal state).
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **Runaway must be reproducible in a test.** If the runaway guard only works "on paper," you haven't built a guard — you've described one. The forever-MockLLM test is the acceptance criterion, not a nice-to-have.
- **No-progress is the cheap guard.** Max-iteration ceilings are necessary but blunt: a tight loop of useless tool calls can spend the whole token budget *within* the iteration limit. Fingerprinting saves budget and escalates sooner.
- **Escalation reuses the human gate.** Multi-agent loops escalating to `AWAITING_HUMAN_INTERVENTION` is correct — a human decides retry/rework/cancel (Spec 2 §7). An auto-reattempt on escalation would be an autonomous loop with a self-authorizing retry.
- **Warnings are not throttles.** `loop.near_limit` informs observability; it does not slow the loop. The only correct responses are "keep going within limits" or "escalate at the ceiling."
- **Do not measure wall-clock in iteration time.** A loop can hit `maxIterations` in seconds (cheap) or `maxWallMs` first (expensive tool calls). All three ceilings must be independently checked *each iteration*.
- **Tomorrow (Day 23):** role taxonomy — Coder/Reviewer/Tester/Orchestrator; AI review augments, never replaces human.

---

*Prev: [Day 21 — Multi-agent Primitives: MapReduce / Critique-Revision / Ensemble](day-21.md) | Next: [Day 23 — Role Taxonomy: Coder/Reviewer/Tester/Orchestrator (AI Review Augments, Never Replaces)](day-23.md)*
