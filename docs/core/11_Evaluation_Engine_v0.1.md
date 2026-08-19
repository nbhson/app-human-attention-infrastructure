# 11. Evaluation Engine (Learning Loop) — Specification

**Status:** Draft v0.1
**Phase:** v0 (offline metrics + A/B harness) ships in Phase 2. Full closed loop in Phase 3.
**Depends on:** Evidence System (9), Attention Engine (6), Human Review decisions (8), Context Engine (4).
**Consumes:** Aggregated events, evidence, review decisions; **produces:** calibration signals.

---

## 1. Purpose

The Harness verifies two different things, and it must not confuse them:

- **Verification Engine (7)** answers: *"Is this change correct?"* — per-task, per-change.
- **Evaluation Engine (11)** answers: *"Is our pipeline correct?"* — across many tasks,
  measuring whether the right changes reached the right humans at the right cost.

Without this, the critical milestone's final step — **Learning** — has no owner. It is a
manual ritual (a human reads a retrospective) instead of a subsystem.

---

## 2. Core Question

> **Is the Harness reducing the amount of Human Attention required to safely accept
> AI-generated changes — without reducing safety?**

Evaluation is how that question is answered with data instead of vibes.

---

## 3. Inputs

- Decision log from the Human Review Interface (8): APPROVE / REJECT / REWORK / outcome.
- Attention assessments from (6): predicted risk, priority, route (human vs auto).
- Evidence from (9): what actually happened (test results, downstream rework, defects).
- Context decisions from (4): what was injected, what was ranked and dropped.

---

## 4. Core Metrics (Phase 2 v0)

### 4.1 Routing quality

- **Precision:** of changes routed to human review, how many actually warranted it
  (rejection / required rework as ground-truth signal).
- **Recall:** of changes that flew through, how many later produced defects or rework
  (missed signal).
- **Escalation leakage:** changes auto-flagged `AUTO_APPROVABLE` that were then rejected
  when a human was (sampling) shown them.

### 4.2 Attention efficiency

- Human minutes per accepted change.
- Attention-weighted risk vs outcome correlation (did HIGH-risk route to the senior reviewer and matter?).
- Inflation monitor: distribution of risk scores over time (guards against score creep).

### 4.3 Pipeline quality

- Verification false-pass rate (passed but later generated a defect).
- Context sufficiency: tasks needing manual context re-supply.

These metrics are computed **offline** from the event/evidence store, not on the hot path.

---

## 5. A/B Harness (Phase 2 v0)

Evaluate pipeline variants head-to-head before merge:

- Replay a set of historical tasks through two pipeline configs (e.g. different ranking
  weights or a new re-ranker), both against the same evidence.
- Compare routing quality + attention efficiency on the same inputs.
- Gate rollouts on the comparison: a new ranker must beat the incumbent on a predefined
  metric before it goes live.

Constraint: Phase-2 evaluation is **shadow** evaluation — it re-runs decisions but does
not override the live path. It is safe by construction.

## 5.1 Benchmark corpus & LLM-as-judge (Phase 3 quality signals)

The A/B harness answers "does variant B beat variant A on pipeline metrics?" — but two
pipeline metrics are only as trustworthy as the **labels** behind them, and pipeline
metrics alone cannot score a single new capability (e.g. "does re-ranking put the file
that actually fixed the bug in the top-N?"). Phase 3 adds two orthogonal quality signals:

- **Benchmark corpus (gold labels).** A frozen set of historical tasks whose correct
  outcomes were confirmed by real human review + downstream absence of defects. These
  labeled tasks form the harness's held-out test set. Rules:
  - The corpus is **versioned and frozen per evaluation run**, so a calibration change
    cannot silently ret-con the labels it is scored against.
  - Corpus composition mirrors real traffic (mix of routed-to-human, auto-approvable,
    REWORK, and defect-caught-later tasks); this prevents the optimizer from over-fitting
    to the easy majority class.
  - A new capability must improve a **predefined metric on the corpus** before rollout —
    mirroring the existing "beat the incumbent" gate in §5.
- **LLM-as-judge (bounded, rubric-scored).** Where a metric has no mechanical ground
  truth — context relevance, review-necessity, style/consistency — a judge model scores
  against a fixed rubric. Rules:
  - Judge output is **evidence**, not verdict: it is stored via the Evidence System (9)
    with `kind: LLM_JUDGE` and the prompt + rubric + model + `seed` hash, so every score
    is reproducible and auditable.
  - Judge scores are **never the sole signal** for a safety decision; they must be
    corroborated by mechanical/metric evidence or a human sampling audit (§8).
  - Judge drift is monitored continuously: a small **gold subset of the corpus** is
    scored every run, and a measurable drop in agreement with the corpus labels triggers
    a re-calibration, not a silent override.

These two signals plug into §6's loop as the *measurement layer*: they do not change
behavior directly; they produce the evidence that `Evaluate → Calibrate` consumes.

---

## 6. Closed Loop (Phase 3)

In Phase 3, evaluation results feed back automatically:

```text
Evaluate → Calibrate (Attention weights, Context ranker) → Deploy → Observe → Evaluate
```

- **Attention calibration:** fit `risk/impact/confidence` weights from review usefulness
  data (replace the Day-18 placeholder constants cleanly).
- **Context ranking:** tune the Ranker from observed relevance (was the injected context
  actually referenced by the agent or the reviewer).
- **Auto-approve:** enable only when P0 calibration (per day-30 backlog) shows
  LOW-label usefulness ≥ threshold; keep kill-switch + sampling audit.

The guardrail is fixed: **no automatic behavior change without measured evidence that it
does not reduce safety.** This is the same principle the whole system enforces on AI
changes, applied to the Harness itself.

---

## 7. Phase Boundaries (explicit)

- **Phase 1:** no Evaluation Engine. Learning = the Day-30 retrospective. The seams exist
  (event log, evidence, decision log, Ranker interface).
- **Phase 2:** v0 = offline metrics + report + shadow A/B harness. Attention calibration
  from real usefulness data (day-30 P0). No auto-approve until calibration passes.
- **Phase 3:** full closed loop; auto-approve (safe subset); continuous calibration;
  benchmark corpus + LLM-as-judge provide gold labels and rubric-scored quality signals.

---

## 8. Non-Goals

- Real-time model training / RLHF. This is offline evaluation + calibration, not training.
- Replacing human judgment. Evaluation informs the human, it never removes the human from
  the safety-critical decision.
- Becoming a general ML platform. Scope is bounded: *measure and tune this Harness.*