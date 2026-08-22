# Week 6 E2E Runbook — The Whole Phase-2 Pipeline, One Task

*Phase 2 · day-27 checkpoint. A narrated, reproducible runbook: drive one
canonical task through the **entire** Phase-2 pipeline — identity-attributed
writes → context (keyword, shadow-compared) → sandboxed-capable agent →
object-store-backed artifact → verification → human review → `task.completed` —
and then **reconstruct that run from append-only telemetry**, proving the pipeline
is not just green but *observable* end-to-end (Spec 10).*

> Day 27 is the system-level "it actually works" proof. Weeks of unit tests can
> stay green while two subsystems are wired *just wrong enough*; this is the first
> time the whole loop is read back as one record. The rule: **a green task you
> can't reconstruct is a red E2E.**

---

## 0. Prereqs & clean stack

```bash
docker compose up -d            # postgres healthy (migrations apply next)
pnpm --filter @harness/db migrate
pnpm seed:e2e-fixture           # idempotent REVIEWER principal (day-27 §3.1)
```

The seeder places the fixed `e2e-reviewer` principal (`roles=['OPERATOR',
'REVIEWER']`) the guarded review routes need; re-running is a no-op
(`onConflictDoNothing`). The E2E driver also re-seeds it after truncating the
schema, so the seeder exists to decouple *environment readiness* from *driver run*
— a Phase-3 canary calls it once at provision time.

---

## 1. The canonical task

`fixtures/e2e/happy-path/` is one safe, representative change: `greeting.ts` ships
a deliberate bug and `greeting.test.ts` exposes it. The task says *"Fix the
greeting bug so the test passes."* The driver copies the fixture into a fresh
sandbox dir and drives it through the real HTTP surface:

```text
POST /api/tasks → dispatch → agent (scripted MockLLM) → write_file fix → apply →
verify (compile + vitest) → attention assessment → route → human approve → merge
→ COMPLETED
```

Determinism is by construction (Spec day-27 §6): scripted `MOCK_LLM_SCRIPT`, no
`ANTHROPIC_API_KEY`, pinned sandbox/working-repo paths, and a fixed mock OIDC
subject so every attribution is reproducible.

---

## 2. Six seams, one run (DI, not direct construction)

The run exercises every Phase-2 seam through the container — `IEventBus`
(assessment/merge events), `Retriever` + `Ranker` (context), `Embedder` (the
deterministic stub in shadow), `ContentStore` (artifact snapshot), `LLMProvider`
(MockLLM) — and none of them are `new`-ed by an engine. That guarantee is a grep:

```bash
pnpm -r test   # runs packages/di/src/__tests__/architecture.test.ts
```

The `seam guards (day-27 §2.4 / §3.4)` block asserts, per seam, that **no engine
package instantiates the seam's concrete class** (e.g. `new ObjectStoreContentStore`,
`new DockerSandbox`, `new InProcessEventBus`). A module that talks to S3 directly
would pass every functional test and break the modular monolith; this grep is the
cheap insurance (plan §6).

---

## 3. Run the vertical slice and read back its telemetry

```bash
pnpm e2e
```

The happy path ends with the reconstruction assertion — this is the Day-27 delta,
not the success print:

```text
[e2e] event chain (14 events): task.state_changed → … → artifact.created →
      task.execution_finished → … → verification.completed → …
      attention.assessment_created → attention.item_routed → review.item_claimed
      → … → review.decision_submitted → artifact.merged → task.state_changed
[e2e] happy path passed
[e2e] reconstructed 14 events, 1 decisions, 1 verifications (trace 1c75…6fee)
```

The driver's `reconstruct(correlation_id)` (in `@harness/observability`) joins the
OTel `trace_correlation` row back to the task id, replays the `event_log` in causal
order, and dumps the decision + verification history. It **throws** on the two
integrity invariants rather than returning rows:

- every `review.decision_submitted` carries a non-null `actor_id` (Days 1–2);
- every `verification_reports` row carries a non-null `content_hash` (Day 22).

Alongside it, four more assertions hold:

| Assertion | What it proves |
|-----------|----------------|
| `reconstruct(taskId).traceId !== null` | `trace_correlation` mapped `trace_id ↔ correlation_id` (Day 3) |
| `servedRankMethod === 'phase1-keyword-dependency'` | the served ranking is still keyword |
| `shadow_rank_comparisons` row exists | the semantic shadow recorded (write-only, no leak) |
| `cacheHit + cacheMiss >= 1` | the context cache moved (Day 20) |

The functional chain prerequisites — `AWAITING_REVIEW`, `PASSED` verification,
evidence rows, routed queue item, `commit_sha` set, all artifacts `MERGED`,
`COMPLETED` — are all asserted *before* the reconstruction block, so a green task
with a broken trace is still red.

---

## 4. Verification: sandboxed by design, in-process for the deterministic driver

The COMPILE check is sandboxed only when `VERIFY_SANDBOX_ENABLED=1` (day-22 §3.3):
`SandboxedCheck` runs `tsc --noEmit -p .` inside the pinned `harness-verify:node20`
container (`--network none`), and degrades to the **in-process parity path** on
`SandboxInfraError` — never a false `FAILED`. The deterministic driver leaves the
flag unset (no `docker build` in the hot path, per §6), so the container path is
proven by the unit suite, not the driver:

```text
packages/sandbox/src/__tests__/image.test.ts       ✓ pinned image build/skip/fail
packages/sandbox/src/__tests__/docker-sandbox.test.ts
packages/verification-engine/src/__tests__/sandboxed-check.test.ts
  ✓ maps exit 0 to PASSED
  ✓ falls back to in-process on SandboxInfraError
  ✓ parity: sandboxed and in-process verdicts agree
```

The verification report still carries the `content_hash` it verified either way, so
the verdict stays attributable to exact bytes. To force the container path in a
canary environment that has the image pre-built:

```bash
docker build -t harness-verify:node20 packages/sandbox
VERIFY_SANDBOX_ENABLED=1 pnpm e2e
```

---

## 5. Green gate

```bash
pnpm lint && pnpm -r typecheck && pnpm -r test   # green
pnpm e2e                                          # happy path + 8 failure scenarios
```

The reference run (actual numbers, recorded for Phase 3's baseline) is in
[`docs/retros/e2e-reference.md`](../../docs/retros/e2e-reference.md).