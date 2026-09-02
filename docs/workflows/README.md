# Thorough Review Workflow

## Purpose

Multi-pass code review workflow that eliminates the non-determinism of the built-in code-review plugin. The built-in review produces inconsistent results (~12 findings one run, ~5 findings the next) because it uses only 5 agents with a single pass and a magical 80-point verification threshold.

This workflow solves that with four techniques:

1. **N-pass review** — 3 rounds × 8 focus lenses (24 agents total) with loop-until-dry
2. **Adversarial verification** — 3 judges per finding (2 neutral + 1 skeptical), majority vote
3. **Critical safeguard** — rejected critical findings get re-verified with a lenient panel
4. **Dedup** — normalized line keys (`Math.floor(line/5)*5`) merge off-by-one duplicates across agents and rounds

## Usage

### Via Claude Code CLI

```bash
# Review an open PR (replace with your PR number)
claude --workflow thorough-review --args '{"pr": "123"}'

# Review a branch against main (no PR needed)
claude --workflow thorough-review --args '{"branch": "fix/review-timeouts-and-ci"}'
```

### Via Workflow API (programmatic)

```javascript
// In a script or another workflow:
Workflow({
  scriptPath: 'docs/workflows/thorough-review.wf.js',
  args: { pr: '123' },
  // or { branch: 'my-branch' }
});
```

## Architecture

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

## Outputs

The workflow returns a JSON object:

```javascript
{
  findings: [
    {
      file: 'packages/review/src/agent.ts',
      line: 142,
      severity: 'major',
      description: 'Type assertion could throw at runtime',
      evidence: 'Type is cast with `as` without runtime validation',
      category: 'type_safety'
    }
  ],
  summary: {
    prNumber: 123,
    prTitle: 'fix(review): timeout handling',
    totalFiles: 12,
    affectedFiles: 3,
    totalFindings: 7,
    bySeverity: { critical: 0, major: 4, minor: 3 },
    byCategory: { type_safety: 2, bug: 1, ... },
    verdictStats: { confirmed: 7, rejected: 107 }
  }
}
```

## Schema Reference

### FINDING

| Field         | Type   | Required | Description                                                                                                           |
| ------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `file`        | string | ✅       | Source file path                                                                                                      |
| `line`        | number | ✅       | Line number (1-indexed)                                                                                               |
| `severity`    | enum   | ✅       | `critical` · `major` · `minor`                                                                                        |
| `description` | string | ✅       | One-line bug description                                                                                              |
| `evidence`    | string | ✅       | Code snippet or quote                                                                                                 |
| `category`    | enum   | ✅       | `security` · `bug` · `performance` · `architecture` · `error_handling` · `code_quality` · `regression` · `compliance` |

### PR_INFO

| Field      | Type           | Required | Description                         |
| ---------- | -------------- | -------- | ----------------------------------- |
| `eligible` | boolean        | ✅       | Is the PR reviewable?               |
| `prNumber` | number \| null | ✅       | PR number or null for branch review |
| `title`    | string         | ✅       | PR title or branch name             |
| `summary`  | string         | ✅       | PR description                      |
| `files`    | string[]       | ✅       | Changed file paths                  |
| `reason`   | string         | ✅       | `OK` or rejection reason            |

### VERDICT

| Field     | Type    | Required | Description                                   |
| --------- | ------- | -------- | --------------------------------------------- |
| `refuted` | boolean | ✅       | `true` = false positive, `false` = real issue |
| `reason`  | string  | ✅       | Why the finding was accepted or rejected      |

## Configuration

| Variable     | Default | Description                          |
| ------------ | ------- | ------------------------------------ |
| `MAX_ROUNDS` | `3`     | Maximum review rounds                |
| `DRY_LIMIT`  | `2`     | Consecutive dry rounds to stop early |

Both can be overridden in the workflow script.

## Differences from Built-in code-review

| Aspect          | Built-in                             | thorough-review                              |
| --------------- | ------------------------------------ | -------------------------------------------- |
| Agents          | 5 Sonnet                             | 24 (8 × 3 rounds)                            |
| Verification    | 1 Haiku, score 0–100, threshold ≥ 80 | 3 judges, majority vote, no magical cutoff   |
| Coverage        | Single pass                          | Loop-until-dry (up to 3 rounds)              |
| Bug types       | General                              | 24 distinct focus lenses                     |
| False positives | ~50% filter rate                     | Adversarial — skeptic judge actively refutes |
| Critical bugs   | Same threshold                       | Safeguard — re-verified with lenient panel   |

## Known Limitations

- **API quota** — Verification is expensive (3 judges × N findings). A PR with ~100 findings needs ~300 judge calls. Run during off-peak or with sufficient quota.
- **Branch diff mode** — When no PR is given, the workflow uses `git diff main...`. Make sure your branch is up-to-date with `main` before running.
- **Line normalization** — Findings within ±2 lines of each other share the same dedup key. Adjacent but distinct bugs may be merged.

## History

- Created to fix non-deterministic results in the built-in `code-review` plugin
- First run on `fix/review-timeouts-and-ci`: 24 review agents → 114 findings → 7 confirmed after adversarial verification
- Rejected 107 false positives that the built-in plugin would have surfaced
