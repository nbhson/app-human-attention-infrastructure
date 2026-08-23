# Day 30 — Week 6 Checkpoint: Hybrid Default; Shadow→Default Clean

| | |
|---|---|
| **Week** | 6 — Hybrid context default |
| **Spec refs** | Phase-3 README §5 (W6 milestone), §7 (hybrid default exit criterion) |
| **Estimated effort** | 5h |
| **Prerequisites** | Days 26–29 (hybrid, re-rank, RAG Fusion, measured cutover) |

---

## 1. Objectives

By end of day you will have:

1. A demonstrable Week-6 milestone: **hybrid (BM25 + embeddings + RRF + re-rank) is the default `rank_method`, and the shadow baseline is cleanly retired** — no dead shadow paths left in the hot path.
2. An end-to-end demo showing the default resolving to `hybrid`, snapshots recording `hybrid`, and the A/B report + cutover decision as evidence.
3. Integration debt closed: shadow scaffolding removed (or gated behind `eval:*` scripts only), guardrail re-checked post-cutover, kill-switch (`keyword`) verified reachable if needed.
4. W6 evidence in `docs/retros/`.

The checkpoint validates the *won* default is real: hybrid is live, measurable, and reversible.

---

## 2. Design Decisions

### 2.1 "Clean" = no hot-path shadow residue

After cutover, the prompt/resolution path must not still compute both rankings "just in case". Shadowing moves behind the offline `eval:*` harness; the live path resolves one retriever from `rank_method`.

### 2.2 Kill-switch remains

`rank_method = keyword` stays a one-config revert. The demo proves it: flip to `keyword`, one request records `keyword`, flip back.

### 2.3 The checkpoint is a verification of Day 29's decision

If Day 29 was HOLD (hybrid did **not** win), then today's checkpoint is "hybrid stayed selectable, default remained keyword, investigation logged" — a *legitimate* W6 outcome, not a failure. The milestone text reads "hybrid default" assuming a WIN; the discipline allows HOLD.

---

## 3. Tasks

### 3.1 Post-cutover guardrail check (45 min)

- [ ] Re-run the A/B report once post-cutover; confirm the verdict still holds.

### 3.2 Shadow cleanup (90 min)

- [ ] Remove hot-path shadow computation; confine shadowing to `eval:*` scripts.

### 3.3 Default + kill-switch demo (60 min)

- [ ] `scripts/demo-hybrid-default.ts` — default resolves to hybrid, one `keyword` revert round-trip.

### 3.4 Docs + evidence (45 min)

- [ ] `docs/architecture/wiring-map.md` (rank_method default = hybrid).
- [ ] `docs/retros/phase3-w6.md`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo-hybrid-default.ts` | Default + kill-switch demo |
| `packages/context-engine/…` (updated) | Hot-path shadow cleanup |
| `docs/architecture/wiring-map.md` (updated) | `rank_method` default = hybrid |
| `docs/retros/phase3-w6.md` | Week 6 checkpoint evidence |

---

## 5. Acceptance Criteria

- [ ] Default `rank_method` resolves to `hybrid`; snapshots record `hybrid`.
- [ ] No hot-path shadow computation remains (only `eval:*` offline).
- [ ] Kill-switch round-trip (`hybrid` → `keyword` → `hybrid`) works.
- [ ] Post-cutover guardrail re-check holds.
- [ ] `pnpm test && pnpm lint` green.

---

## 6. Notes & Pitfalls

- **If Day 29 was HOLD, the checkpoint is HOLD-verified.** Don't manufacture a WIN; record the held-state and why.
- **Cleanup is part of the checkpoint.** A default with both paths still running hot is a shadow, not a cutover — the "no hot-path shadow" criterion is load-bearing.
- **Week 7 closes the loop** — review decisions + judge signals feed calibration/routing automatically.
- **Next (Day 31):** learning pipeline — review decisions → calibration update (automated).

---

*Next: [Day 31 — Learning Pipeline: Review Decisions → Calibration Update (Automated)](day-31.md)*