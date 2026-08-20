# Day 25 — Week 5 Checkpoint: Sandbox + Object Store + Cache Integrated

| | |
|---|---|
| **Week** | 5 — Sandbox, object store, Spec 8 |
| **Spec refs** | Spec 7 §5.5 (sandbox), Spec 5 §4.2 (object store), Spec 4 §5.2.3 (cache), Spec 10 (observability governance), Spec 11 §4 (pipeline quality) |
| **Estimated effort** | 6 hours |
| **Prerequisites** | Days 21–24 (object store, sandbox ×2, Spec 8) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. By end of day you will have:

1. An **integrated demo** — one task runs end-to-end through object-store retrieval, sandboxed verification, and cache (second run hits), with every stage visible in the shadow metrics report.
2. **Week-5 subsystems proven together** — object store *feeds* the sandbox a `content_hash`, the cache *skips* refetching an unchanged source, and the whole run is attributable (`content_hash` on the verification result, `code_mode_sessions` for code mode).
3. A **Week-5 retrospective** stating whether the new subsystems changed any Phase-2 metric for the worse (e.g., sandbox latency in dwell) and what hardening (Day 26) must prioritize.

**Do not leave Week 5 shipping the sandbox as the only verification path if parity or latency regressed.** The subsystems integrate; they don't silently replace anything yet — that's Day 26's hardening decision.

---

## 2. What Week 5 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| Object store (S3/MinIO `ContentStore`) | `@harness/object-store` | ✅ Day 21 |
| Sandbox — verification (Spec 7 §5.5) | `@harness/sandbox` | ✅ Day 22 |
| Sandbox — agent Code Mode (Spec 3 §14.3) | `@harness/sandbox` + `@harness/agent-runtime` | ✅ Day 23 |
| Spec 8 (Human Review Interface) | `docs/core/8_*` | ✅ Day 24 |

---

## 3. Tasks

### 3.1 Integrated pipeline demo (90 min)

`scripts/demo/week5-integration.md`:
1. Create a large artifact → object store `put` (backend `object`); small artifact → Postgres (`db`).
2. Run a task whose verification check runs in the sandbox; show the `content_hash` on the result and the `--network none` verdict.
3. Re-run the *unchanged* task → cache hit (zero file reads), sandbox result re-linked to the same hash.
4. Show the code-mode path writing a `code_mode_sessions` row with `tool_calls`.

### 3.2 Shadow metrics → report (60 min)

- [ ] Extend the Day-7 report generator to render the Week-4/5 shadow signals in one place: `shadow_rank_comparisons` correlation, cache hit/miss ratio, sandbox latency + fallback rate, object-store integrity errors.
- [ ] Confirm the default `rank_method` is still `keyword` in the report (the invariant is *visible*, not just true).

### 3.3 Regression scan (60 min)

- [ ] Run the Phase-1 verification/context/attention suites over the new subsystems; log any test or metric that moved (sandbox latency, cache-hit changes) as either intended or a regression.

### 3.4 Week-5 retro (60 min)

`docs/retros/week-05.md` — did the new subsystems change any Phase-2 number for the worse? Which failure surface (vector/index, object store, sandbox) is likeliest to bite first, and so what should Day-26's failure injection hit hardest?

### 3.5 Green the gate + reset (up to 2h)

- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green.
- [ ] Leave sandbox in fallback-safe mode (in-process parity path armed), auto-approve OFF (Day 14), semantic shadow OFF by default.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo/week5-integration.md` | End-to-end subsystem demo |
| `packages/evaluation/src/report/sections.ts` (updated) | Shadow + cache + sandbox metrics sections |
| `docs/retros/week-05.md` | Week-5 retro |
| `docs/architecture/wiring-map.md` (updated) | Week-5 status |

---

## 5. Acceptance Criteria

- [ ] The demo completes one task through object store → sandboxed verification → cache (second run), each stage attributable by `content_hash`.
- [ ] The report renders shadow correlation, cache hit/miss, sandbox latency + fallback rate, and object-store integrity errors.
- [ ] The report states the served `rank_method === 'keyword'` (invariant visible).
- [ ] The regression scan lists any moved test/metric, each annotated intended/regression.
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green.
- [ ] No engine imports another engine (architecture test green).
- [ ] System left in safe defaults: in-process parity path armed, auto-approve OFF, semantic shadow OFF.
- [ ] Week-5 retro names the single likeliest failure surface for Day-26 hardening.

---

## 6. Notes & Pitfalls

- **"Integrated" ≠ "works once".** The checkpoint's value is the *second* run hitting the cache and re-linking the same hash — proof the new address spaces (object store, sandbox, cache) are consistent, not just demoable.
- **The shadow metrics must make the invariant *visible*.** If the report shows cute charts but never states `rank_method === 'keyword'`, a shadow leak could hide behind pretty numbers. The invariant is a line item, assert it.
- **Don't cut over to sandbox-only on demo success.** Week 5 proves the subsystems *work together*; Day 26 proves they *survive failure*. Flip the default only after failure injection, not after a happy-path demo.
- **Sandbox latency is the first place regression hides.** Container startup cost can quietly inflate dwell and task latency. Measure it per-run (Day 4 counters) now, so Day 26 has a baseline to detect drift against.
- **Track the fallback rate explicitly.** If the sandbox silently falls back to in-process, the isolation you built is not actually being used. The report's fallback-rate number is the single best liveness signal for the whole week.
- **Next (Day 26):** hardening — failure injection on vector/index, object store, and sandbox, plus concurrency, so the Week-5 systems degrade safely under stress.

---

*Prev: [Day 24 — Promote Spec 8](day-24.md) | Next: [Day 26 — Hardening: Failure Injection & Concurrency](day-26.md)*