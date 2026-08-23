# Day 10 — LLMProvider seam + OpenAICompatibleProvider + MockLLM

| | |
|---|---|
| **Week** | W2 — Review ingest core |
| **Spec refs** | Spec 3 §1 (LLM seam), Spec 1 §5 (no hard LLM dependency) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 09 (provider-seam conventions) |

---

## 1. Objectives

- Define the `LLMProvider` seam (`complete`) that turns a prompt into model text, independent of vendor.
- Implement `OpenAICompatibleProvider` driven by `{ key, baseUrl, model }` — so any OpenAI-compatible endpoint can serve as the reviewer.
- Implement `MockLLM` (deterministic, scriptable) so review tests run with no paid provider and no network.
- Provide a provider registry/resolution via DI, and compile-test (never call) the real path only.

## 2. Design Decisions

- The provider is **text-in/text-out only** — the review prompt and schema parsing belong to `ReviewAgent` (Day 11), not the transport.

```ts
export interface LLMProvider {
  readonly model: string;
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}
// config: { key: string; baseUrl: string; model: string }
```

- `MockLLM` can be primed with per-prompt responses (and latencies/errors) so the ingest path is testable without a live key; the real provider path is exercised only in a **compile-test**, never in unit tests.
- Tokens are injected via config/env and never logged (enforcement Deep on Day 27).

## 3. Tasks

### 3.1 Seam + types (90 min)
- [ ] `packages/agent-runtime/src/llm/llm-provider.ts` interface + `CompleteOptions`
- [ ] LLM config type (`key` + `baseUrl` + `model`) + provider factory

### 3.2 OpenAICompatible + Mock (150 min)
- [ ] `openai-compatible-provider.ts` (chat-completions via injected HTTP client)
- [ ] `mock-llm.ts` (scriptable responses/errors/latency)
- [ ] DI registration resolving the provider from config

### 3.3 Tests (120 min)
- [ ] MockLLM unit tests; OpenAI-compatible request-shape test on a recorded fixture; compile-only check for the real provider

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/agent-runtime/src/llm/llm-provider.ts` | `LLMProvider` seam |
| `packages/agent-runtime/src/llm/openai-compatible-provider.ts` | OpenAI-compatible impl |
| `packages/agent-runtime/src/llm/mock-llm.ts` | Deterministic mock |
| `packages/agent-runtime/src/llm/provider-factory.ts` | Config-driven provider resolution |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/agent-runtime test` passes with `MockLLM` only (no network, no key)
- [ ] A scripted `MockLLM` returns the exact primed text for a prompt
- [ ] `OpenAICompatibleProvider` builds the correct request body for `{key, baseUrl, model}` on a fixture transport
- [ ] No real API key is required (or read) by unit tests

## 6. Notes & Pitfalls

- Keep provider-specific parsing (JSON-schema output extraction) out of this layer — that's the Day 11 `ReviewAgent`'s job.
- Only OpenAI-compatible + mock exist today; Anthropic is a seam swap later, not a fork of the review logic.

---

*Next: [Day 11 — ReviewAgent — structured ReviewAgentOutput (report + findings + suggestions)](day-11.md)*