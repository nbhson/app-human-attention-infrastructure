# Thorough Review Workflow

> **⚠️ ARCHIVED — Not part of HAI Harness product.**
>
> This workflow is a standalone **Claude Code CLI** multi-pass review tool, separate from the Harness product.
> It was created as an experimental reference for N-pass adversarial review patterns.
>
> The Harness product (`@harness/agent-runtime` + `ReviewAgent` + `Judge` + `AttentionEngine`)
> implements a similar goal with a single-pass structured review + rubric-scoring judge,
> which is far more cost-effective than 24 agents × 3 rounds.
>
> **Reference only.** Do not treat this as part of the Harness documentation.

## Original Purpose

Multi-pass code review workflow that eliminates the non-determinism of the built-in code-review plugin. The built-in review produces inconsistent results (~12 findings one run, ~5 findings the next) because it uses only 5 agents with a single pass and a magical 80-point verification threshold.

This workflow solves that with four techniques:

1. **N-pass review** — 3 rounds × 8 focus lenses (24 agents total) with loop-until-dry
2. **Adversarial verification** — 3 judges per finding (2 neutral + 1 skeptical), majority vote
3. **Critical safeguard** — rejected critical findings get re-verified with a lenient panel
4. **Dedup** — normalized line keys (`Math.floor(line/5)*5`) merge off-by-one duplicates across agents and rounds

## Original Usage (Claude Code CLI only)

```bash
# Review an open PR (replace with your PR number)
claude --workflow thorough-review --args '{"pr": "123"}'

# Review a branch against main (no PR needed)
claude --workflow thorough-review --args '{"branch": "fix/review-timeouts-and-ci"}'
```

## Architecture (for reference)

```
Phase 1: Prepare
  └── PR info agent → PR number, title, diff, changed files

Phase 2: Review (loop-until-dry, max 3 rounds)
  ├── Round 1: Security, Logic Bugs, Concurrency, Error Handling,
  │           Type Safety, Data Flow, Edge Cases, Dependency
  ├── Round 2: Architecture, Performance, Regression, Compliance,
  │           Testability, Migration, Resource Mgmt, Observability
  └── Round 3: Code Quality, Business Logic, State Management,
              Timing, Configuration, Validation, Debugging, Consistency
  (8 agents × 3 rounds = 24 review agents)

Phase 3: Verify (3 judges per finding)
  ├── Judge 1: Neutral verifier (default: not refuted)
  ├── Judge 2: Neutral verifier (independent, default: not refuted)
  └── Judge 3: Skeptical verifier (default: refuted)
  → Keep if ≥2/3 judges agree it's real
  → Critical findings get re-verified with lenient panel (keep if ≥1/3)

Phase 4: Synthesize
  → Dedup by file + normalized line (nearest 5)
  → Severity classification (critical > major > minor)
  → Categorized report
```

## Key Differences from HAI Harness

| Aspect | Thorough Review (this workflow) | HAI Harness |
|--------|--------------------------------|-------------|
| Agents | 24 (8 × 3 rounds) | 1 (ReviewAgent) |
| Verification | 3 judges per finding | 1 judge (rubric-scored) |
| Cost | ~300 LLM calls per PR | ~2 LLM calls per PR |
| Determinism | Loop-until-dry | Structured prompt + versioned rubric |
| Integration | Standalone CLI | Full control plane (ingest → review → decision → write-back) |
| Memory | None | Review memory with consolidation/decay/archive |
| Attention routing | None | 5-factor scoring + adaptive thresholds |
| Verification | None | Docker sandbox build/test |

## History

- Created to fix non-deterministic results in the built-in `code-review` plugin
- First run on `fix/review-timeouts-and-ci`: 24 review agents → 114 findings → 7 confirmed after adversarial verification
- Rejected 107 false positives that the built-in plugin would have surfaced
- Archived when Harness product shipped with equivalent-quality single-pass review + judge
