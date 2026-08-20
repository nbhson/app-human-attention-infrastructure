# Day 21 — Context Delivery, Freshness & Week 3 Checkpoint

| | |
|---|---|
| **Week** | 3 — Trust Pipeline |
| **Spec refs** | Spec 4 §8 (Freshness/invalidation), §7 (Interaction with Agent Runtime) |
| **Estimated effort** | 4 h + 2 h checkpoint |
| **Prerequisites** | Day 20 (context_snapshots, content_hash), Day 07/14 (checkpoint format) |

---

## 1. Objectives

1. Implement **freshness checking**: before dispatch, re-hash `target_files` and mark the snapshot `STALE` if any changed (Spec 4 §8).
2. Define the **STALE policy**: default = re-resolve target files only, keep the rest; consumer may still use STALE with a trajectory warning.
3. Deliver context to the Agent Runtime in a **structured prompt format** (project / task / file sections).
4. **Week 3 hard checkpoint** — go/no-go gate for the entire trust pipeline (verify → evidence → attention → context).

> **Why this matters:** a snapshot is a point-in-time view. If a human edits a file between context resolution and agent execution, the agent works on phantom content and produces unverifiable diffs. Freshness checking is cheap insurance against a whole class of confusing failures.

---

## 2. Design Decisions

### 2.1 Freshness check

```ts
// packages/context-engine/src/freshness.ts
export type Freshness = 'FRESH' | 'STALE';

export async function checkFreshness(
  snapshot: ContextSnapshot,
  projectRoot: string,
): Promise<{ freshness: Freshness; staleSources: string[] }> {
  const stale: string[] = [];
  for (const s of snapshot.sources) {
    const current = sha256(await readFileSafe(projectRoot, s.sourceId));
    if (current !== s.contentHash) stale.push(s.sourceId);
  }
  return { freshness: stale.length ? 'STALE' : 'FRESH', staleSources: stale };
}
```

**Policy (default, configurable per project):** on STALE → re-resolve **only the stale sources** (re-collect + re-rank those paths), patch them into the snapshot, record `freshness_events` in metadata. Full re-resolution is available but not default (wasteful). If the agent is already running when staleness is detected, we do **not** interrupt — the trajectory records the warning (Spec 4 §8: "Consumers may still use a STALE snapshot with a warning").

### 2.2 Structured delivery format

AgentRunner (Day 12) renders the snapshot into the system prompt:

```text
## Project Context
[architecture rules — Phase 1: static CONVENTIONS.md if present]

## Task
{description}
{requirements}

## Relevant Files (ranked, budgeted)
### src/payment/PaymentService.ts (relevance: 0.92)
```ts
…content…
```
### src/payment/types.ts (relevance: 0.71)
…
```

Rendering is a pure function `renderContextPrompt(snapshot): string` — unit-tested, no LLM involved.

### 2.3 Week 3 Checkpoint (hard gate)

Same format as Day 07/14. Run `scripts/week3-smoke.ts` against the Compose stack:

| # | Criterion | How verified |
|---|---|---|
| 1 | Full pipeline: task → EXECUTE → VERIFY → AWAITING_REVIEW with PASSED report | seed task, watch `task_state_history` |
| 2 | Every PASSED report has ≥ 1 evidence row (Day-17 invariant) | SQL count query |
| 3 | Every AWAITING_REVIEW task has an `attention_assessments` row and a `review_queue` row | SQL join |
| 4 | Flaky test → report PASSED with `flaky: true` → routed REVIEW_REQUIRED (rule r3) | fixture suite from Day 16 |
| 5 | Context snapshot persisted, budget respected, freshness check detects a mid-flight edit | integration test |
| 6 | Provenance chain (Day 17) returns all 7 sections for the seed task | `buildProvenanceChain` output non-empty |
| 7 | `pnpm test && pnpm lint` green; boundary tests green | CI command |

**Rule (same as Weeks 1–2): if any criterion is red, stop. Fix before proceeding to Week 4.** The human loop (Days 22–24) is built on the assumption that the trust pipeline underneath is solid.

Retro (30 min): what slowed us down in Week 3? Adjust Week 4 estimates if needed.

---

## 3. Tasks

- [ ] **3.1** `checkFreshness` + STALE re-resolve policy + trajectory warning path. (1.5 h)
- [ ] **3.2** `renderContextPrompt` pure renderer + AgentRunner integration. (1 h)
- [ ] **3.3** Tests: freshness detects edit; re-resolve patches only stale sources; renderer output stable (snapshot test). (1 h)
- [ ] **3.4** `scripts/week3-smoke.ts` + run full checkpoint table + retro. (2 h)

---

## 4. Deliverables

| File | Description |
|---|---|
| `packages/context-engine/src/freshness.ts` | STALE detection + re-resolve policy |
| `packages/context-engine/src/render.ts` | Structured prompt renderer |
| `scripts/week3-smoke.ts` | Week 3 checkpoint script |

---

## 5. Acceptance Criteria

- [ ] Editing a target file after `resolveContext` → next dispatch detects STALE and re-resolves that file only.
- [ ] STALE usage by a running agent records a warning in `trajectory_steps`.
- [ ] Rendered prompt contains all three sections and never exceeds the snapshot's token budget.
- [ ] All 7 Week-3 checkpoint criteria green (or work stops until they are).

---

## 6. Notes & Pitfalls

- **Re-resolve is not free** — it re-runs collection for stale paths; keep it scoped to stale sources only, or a busy repo turns every dispatch into a full rescan.
- **Don't block dispatch on STALE** — the default policy patches and proceeds; blocking would let a single frequently-edited file starve the queue.
- **Checkpoint discipline:** Weeks 1–2 proved the value of stopping on red. Week 4 (human loop + E2E) is the most visible week — resist the urge to "fix it later."
- **Next:** [Day 22 — Review Backend: Queue API & Decisions](day-22.md) opens the human loop on top of the Day-19 `review_queue`.

---

*Prev: [Day 20 — Context Engine: Collect, Rank & Budget](day-20.md) | Next: [Day 22 — Review Backend: Queue API & Decisions](day-22.md)*
