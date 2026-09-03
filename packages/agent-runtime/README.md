# @harness/agent-runtime — LLM seam + reviewer

The AI _review_ runtime: the LLM-provider seam (Anthropic + any OpenAI-compatible
endpoint, plus a deterministic mock), response mapping, prompt/response logging
for provenance, and `ReviewAgent` — the read-only reviewer that turns a PR diff +
requirement into a structured report.

**Status:** review-reorient — the code-generation path (ReAct loop, `write_file`
tools, trajectory recorder, Code-Mode tier stack) is **retired**. ·
**Boundary rule:** engine — imports only shared packages.

---

## Purpose

1. **Provide an LLM seam** — a single `LLMProvider` interface behind which sit
   `AnthropicProvider` and `OpenAICompatibleProvider` (`key` + `baseUrl` + `model`,
   `/chat/completions` — the "any provider" escape hatch).
2. **Review a PR** — `ReviewAgent.review()` asks the model to act as _reviewer_
   (never author): read the diff + requirement, return `ReviewAgentOutput`
   (`summary` + `overallVerdict` + `findings[]` + `suggestions[]`).
3. **Record LLM calls** — `LoggingLLMProvider` captures every prompt/response to
   evidence without changing behaviour.

> **Core principle:** the AI **reviews** — it proposes findings and fix
> suggestions, but writes no code. Writing/committing code was the retired
> code-gen path.

---

## Review shape

```typescript
interface ReviewAgentOutput {
  summary: string; // plain-English summary of the PR
  overallVerdict: ReviewVerdict; // APPROVE | REQUEST_CHANGES | REJECT
  findings: ReviewFindingOutput[]; // severity · file · line? · message · suggestion?
  suggestions: FixSuggestionOutput[]; // file · hunk? · proposed · rationale
}
```

`ReviewAgent.review({ prUrl, prTitle, requirement, diff }, { model, correlationId })`
returns this shape; the caller (`ReviewIngestService`) assigns identity and
persists it into `review_reports` / `review_findings` / `fix_suggestions`.

### Batch review

For large PRs, `batchReview()` splits files into parallel batches and merges
findings/suggestions. Each batch is reviewed independently by the AI model, and
results are merged by severity (findings) and file (suggestions). An optional
`onBatch` callback fires per-batch as each resolves — this is the mechanism
behind progressive findings:

```typescript
batchReview(
  agent, files,
  { prUrl, prTitle, requirement, model, correlationId,
    maxBatchSize, maxBatchTokens, instructions? },
  onBatch?, // (batchIndex, batchCount, output) => Promise<void>
)
```

When `instructions` is provided (the operator-uploaded "text.md" skills file
from the Triage Rules page), it is injected into every batch's prompt as an
authoritative guidance section — the PR + Jira + text.md + AI flow.

### Context-aware file budgeting

`budgetFiles()` ranks files by keyword overlap and trims to a token budget.
Files within the budget become the `primary` set; the rest are `overflow`:

```typescript
budgetFiles(files, { keywords, maxTokens, maxSources });
// => { primary: PullRequestFile[], overflow: PullRequestFile[] }
```

This is used to prioritise the most relevant files when the PR exceeds the
AI provider's token limit.

### Two-pass review (optional)

When enabled, the review runs a fast `summarizeFiles()` pass first (risk
assessment per file), then only reviews `high`/`medium` risk files in detail:

```typescript
interface FileSummary {
  file: string;
  risk: 'high' | 'medium' | 'low';
  summary: string;
}
```

---

## Modules

| Module                              | What it provides                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `llm/llm-provider.ts`               | The provider seam (`LLMProvider`).                                                      |
| `llm/anthropic-provider.ts`         | Real Anthropic provider (compile-tested; no live keys in-repo).                         |
| `llm/openai-compatible-provider.ts` | Generic `key`+`baseUrl`+`model` provider via `/chat/completions`.                       |
| `llm/mock-llm.ts`                   | Deterministic scripted mock — the DI default.                                           |
| `llm/logging-provider.ts`           | Wraps a provider to log calls to evidence.                                              |
| `llm/map-anthropic-response.ts`     | Anthropic response → normalized shape.                                                  |
| `llm/map-openai-response.ts`        | OpenAI-compatible response → normalized shape.                                          |
| `review/review-agent.ts`            | `ReviewAgent` — read-only reviewer.                                                     |
| `review/review-output.ts`           | `ReviewAgentOutput` / `ReviewFindingOutput` / `FixSuggestionOutput` value objects.      |
| `review/review-batch.ts`            | `batchReview()` — split files into parallel batches, merge results, per-batch callback. |
| `review/review-prompt.ts`           | `buildReviewPrompt()` — system + user prompt with instructions, memories, mode support. |
| `review/review-budget.ts`           | `budgetFiles()` — context-aware file prioritisation by keyword overlap.                 |

---

## Interaction with other packages

```text
               ┌──────────────────────────┐
               │      agent-runtime       │
               └───────────┬──────────────┘
                           │  (never imports another engine)
     ┌──────────┬───────────┼───────────────┬────────────┐
     ▼          ▼           ▼               ▼            ▼
 @harness/  @harness/   @harness/       @harness/    @harness/
 domain      event-bus     db              di         (none)
```

`ReviewAgent` depends only on `LLMProvider` and `@harness/domain` types. It is
invoked by `apps/api`'s `ReviewIngestService`, never the other way round.

---

## Key invariants

- **No live keys in-repo.** The real provider paths are compile-tested only;
  `.env.example` carries placeholders and the DI default is the deterministic
  `MockLLM`.
- **Read-only review.** The reviewer has no write tools — findings and fix
  suggestions are data, never applied.
- **Provenance.** `LoggingLLMProvider` records every call so the review trail
  joins the append-only `event_log` by `correlation_id`.

---

## Directory structure

```
src/
├── index.ts
├── llm/               # provider seam + anthropic + openai-compatible + mock + logging + mappers
└── review/            # review-agent, review-output
```

## Public API surface

```typescript
// llm seam
(LLMProvider,
  AnthropicProvider,
  OpenAICompatibleProvider,
  MockLLM,
  LoggingLLMProvider,
  mapAnthropicResponse,
  mapOpenaiResponse);
// review
(ReviewAgent,
  ReviewAgentOutput,
  ReviewFindingOutput,
  FixSuggestionOutput,
  FileSummary,
  ReviewPromptInput,
  batchReview,
  budgetFiles,
  mergeOutputs);
```

## Wiring

Registered in `apps/api/src/bootstrap.ts`: `TOKENS.LLMProvider` resolves to
`LoggingLLMProvider(AnthropicProvider | OpenAICompatibleProvider | MockLLM)`,
and `TOKENS.ReviewAgent` wraps it. The review slice resolves both out of the
container on the first `POST /api/reviews`.
