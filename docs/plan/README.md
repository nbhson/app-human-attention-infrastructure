# HAI Harness — Implementation Plans

The build is delivered in three phases. Each phase is an independent plan directory, gated by the exit criteria in Architecture §24.

| Phase | Directory | Theme | Estimate |
|-------|-----------|-------|----------|
| 1 | [phase-1/](phase-1/README.md) | Prove the Core Loop — vertical slice, evidence before confidence | 30 days (complete) |
| 2 | [phase-2/](phase-2/README.md) | Calibrate & Close the Measurement Loop — evaluation, calibration, semantic infra (shadow) | 30 days |
| 3 | [phase-3/](phase-3/README.md) | Learn & Automate Under Guardrails — memory, hybrid default, multi-agent, closed loop | 40 days |

**Total: ~100 working days.**

Each phase README carries: goal, sizing rationale, tech-stack delta, weekly milestones, a daily breakdown table, and exit criteria. Every phase contains one detailed file per day (`phase-N/day-NN.md`) in the same format — Phase 1 has `day-01..30`, Phase 2 `day-01..30`, Phase 3 `day-01..40`.

Phase exit criteria (Architecture §24.3): **1 → 2** the loop is demountable end-to-end with queryable evidence; **2 → 3** the pipeline is measured (precision/recall, fitted weights, A/B harness); **3** the *Learning* step closes automatically.