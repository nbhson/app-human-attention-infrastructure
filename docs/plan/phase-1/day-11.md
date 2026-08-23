# Day 11 — ReviewAgent — structured ReviewAgentOutput (report + findings + suggestions)

| | |
|---|---|
| **Week** | W2 — Review ingest core |
| **Spec refs** | Spec 3 §1 (Review Agent), Spec 1 §3 (AI as read-only reviewer) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 10 (`LLMProvider` + `MockLLM`) |

---

## 1. Objectives

- Build `ReviewAgent` that turns a PR diff + requirement into a **structured review**, not free text.
- Define and validate the output shape — the AI is **read-only**: it produces a report, findings, and fix suggestions, never code to commit.
- Prompt for a stable JSON contract and parse safely, clamping unknown verdicts/severities and dropping malformed findings.
- Persist-ready bindings: assign `ReviewReport`/`ReviewFinding`/`FixSuggestion` identities from the raw AI output.

## 2. Design Decisions

- The AI's job is `Review / Analyze / Explain` only. `ReviewAgent` has exactly one operation: `review(...) → ReviewAgentOutput`.

```ts
export interface ReviewAgentOutput {
  readonly summary: string;
  readonly overallVerdict: ReviewVerdict;       // APPROVE | REQUEST_CHANGES | COMMENT
  readonly findings: ReviewFindingOutput[];
  readonly suggestions: FixSuggestionOutput[];
}
export interface ReviewFindingOutput {
  readonly severity: ReviewSeverity;            // CRITICAL|MAJOR|MINOR|NIT|INFO
  readonly file: string;
  readonly line?: number;
  readonly message: string;
  readonly suggestion?: string;                 // pointer, not a patch
}
export interface FixSuggestionOutput {
  readonly file: string;
  readonly hunk?: string;                       // @@ -.. +.. @@ context
  readonly proposed: string;                    // proposed replacement
  readonly rationale: string;
}
```

- The prompt asks for JSON; `parseReviewOutput` validates with a clamp-not-crash policy: unknown verdict → `COMMENT`, unknown severity → `INFO`, finding missing `file`/`message` → dropped. No tool/function-calling or code-execution path exists.
- No embeddings or semantic retrieval here (Phase 2+); the context passed in is what the reviewer sees.

## 3. Tasks

### 3.1 Output types + prompt (120 min)
- [ ] `review/review-output.ts` — `ReviewAgentOutput`, `ReviewFindingOutput`, `FixSuggestionOutput`
- [ ] `review/review-prompt.ts` — JSON schema-bearing prompt (diff + requirement)

### 3.2 Parser (120 min)
- [ ] `review/parse-review.ts` — clamp/validate/drop rules + unit tests
- [ ] `review/parse-review.test.ts` — unknown-level clamps, malformed drops, ordering

### 3.3 Agent + binding (150 min)
- [ ] `review/review-agent.ts` — `review()` composing provider + parser
- [ ] Bind raw output to `ReviewReport` + `ReviewFinding` IDs (via `@harness/domain`)

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/agent-runtime/src/review/review-output.ts` | Output value objects |
| `packages/agent-runtime/src/review/review-prompt.ts` | Reviewer prompt |
| `packages/agent-runtime/src/review/parse-review.ts` | Safe JSON parser |
| `packages/agent-runtime/src/review/review-agent.ts` | `ReviewAgent` orchestration |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/agent-runtime test` passes with `MockLLM` primed to return a JSON review
- [ ] A well-formed model response yields a `ReviewAgentOutput` with ordered findings + suggestions
- [ ] Unknown `overallVerdict` clamps to `COMMENT`; unknown severity clamps to `INFO`; findings without `file`/`message` are dropped
- [ ] Review of an empty/trivial diff returns `APPROVE` with `findings: []`

## 6. Notes & Pitfalls

- The AI outputs proposals only; nothing here touches git. The "replacement" in `FixSuggestionOutput.proposed` is display copy for a human, never an applied patch.
- Keep parsing pure and exhaustively tested — the whole trust story depends on a model's arbitrary text mapping to strict types.

---

*Next: [Day 12 — ReviewIngestService — parse PR URL → fetch → create task (CANCELLED) → review → persist](day-12.md)*