# Day 19 — Exact Tokenizer: tiktoken Replaces `chars/4`

| | |
|---|---|
| **Week** | 4 — Semantic infra (shadow) |
| **Spec refs** | Spec 4 §8 (Tokenizer strategy), §5.2.4 (validation gate token budget), §2.3 (`max_tokens`) |
| **Estimated effort** | 6 hours |
| **Prerequisites** | Day 18 (shadow retriever); Phase-1 `Tokenizer` interface with `chars/4` counter; budget trimmer |

---

## 1. Objectives

By end of day you will have:

1. An **exact tokenizer** (`tiktoken` / provider-specific) behind the existing `Tokenizer` interface, replacing the `chars/4` approximation for token counting.
2. A **budget trimmer update** — the trimmer now uses exact token counts, with the exact same priority rules (never drop target files, never drop Level-0/architecture, evict bottom-up).
3. A **fidelity comparison** proving the new tokenizer's counts are *accurate* against a known reference (not just different) — and flagging any regression where `chars/4` was under- or over-counting badly enough to have changed a budget decision.
4. **Model-aware budgets** — `max_tokens` interpreted with the tokenizer of the *target model* (Spec 4 §8's rule), never a global constant.

Why now: token count is the denominator of the entire context budget. `chars/4` under- and over-counts code (whitespace, symbols, non-Latin text) in ways that silently waste budget or truncate content. Before Week 5's cache can be trusted to "respect budget", the budget's unit must be honest.

---

## 2. Design Decisions

### 2.1 Interface unchanged, implementation swapped

Phase-1 declared the seam; today we fill it with a real counter.

```typescript
// packages/context-engine/src/tokenizer/tiktoken-tokenizer.ts
import { encoding_for_model } from 'tiktoken';

export class TiktokenTokenizer implements Tokenizer {
  constructor(private encoding: ReturnType<typeof encoding_for_model>) {}
  count(text: string): number { return this.encoding.encode(text).length; }
  truncate(text: string, maxTokens: number): string { /* encode → slice → decode */ }
  readonly name: 'tiktoken';
}
```

`Tokenizers.get(model)` maps a model id → the correct encoding (`cl100k_base` for GPT-4-family, `o200k_base` for newer) — a model column already exists on the request (`modelConfig.model`), so the tokenizer resolution is per-request, not global (Spec 4 §8).

### 2.2 Fidelity is proven against a reference, not asserted

The acceptance test embeds a **gold corpus** of strings (code, prose, symbols, CJK, whitespace-heavy) with known token counts (pre-computed by running the reference encoder once and committing the numbers). The tokenizer must match to within 0 (exact, since it *is* the reference encoder). The real risk to test is **the wiring**, not the encoder: that `resolveContext` uses the exact tokenizer for budget decisions, not `chars/4`.

### 2.3 The budget decision diff — where `chars/4` would have broken

Compute a **regression report** comparing `chars/4` vs exact on a sample of stored `context_sources`:

```text
source_id, chars4_count, exact_count, delta_pct, would_have_changed_selection?
```

The last column is the load-bearing one: a large delta that *didn't* change a selection is interesting; a small delta that *did* (one file just over/under budget) is the bug `chars/4` hid. The trimmer's unit test now asserts a fixture where `chars/4` would have wrongly dropped a target-adjacent file but the exact tokenizer keeps it.

### 2.4 Validation gate re-anchors

The Day-18 validation gate (`total_tokens ≤ max_tokens`, hard fail — Spec 4 §5.2.4) re-anchors on the exact tokenizer. Since exact counts are typically *lower* than `chars/4` for code, budgets that were previously "full" may gain headroom; nothing should silently *exceed* budget after the swap. Re-run the gate tests with exact numbers.

---

## 3. Tasks

### 3.1 Tokenizer implementation + registry (90 min)

- [ ] `packages/context-engine/src/tokenizer/tiktoken-tokenizer.ts` (§2.1).
- [ ] `packages/context-engine/src/tokenizer/registry.ts` — `getTokenizer(model)`; fall back to `o200k_base` for unknown models (log the fallback).

### 3.2 Budget trimmer update (120 min)

- [ ] `packages/context-engine/src/compression/budget-trimmer.ts` — call `tokenizer.count` everywhere `chars/4` was used; keep priority rules identical.
- [ ] Wire `resolveContext` to resolve the tokenizer from the request's model (§2.1).

### 3.3 Gold corpus + fidelity tests (90 min)

- [ ] `packages/context-engine/src/__tests__/gold-corpus.ts` — committed known-count strings.
- [ ] Test: tokenizer matches gold to exactness; `truncate` leaves no partial multi-byte sequences.

### 3.4 Regression report CLI (60 min)

- [ ] `pnpm context:token-report` — emits the §2.3 diff over stored sources; save as a doc artifact.

### 3.5 Gate re-anchor + tests (45 min)

- [ ] Re-run validation-gate tests with exact counts; assert no fixture now exceeds budget after the swap.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/tokenizer/tiktoken-tokenizer.ts` | Exact tokenizer |
| `packages/context-engine/src/tokenizer/registry.ts` | Per-model resolution |
| `packages/context-engine/src/compression/budget-trimmer.ts` (updated) | Exact counts |
| `packages/context-engine/src/__tests__/gold-corpus.ts` | Known-count reference |
| `scripts/context-token-report.ts` | chars/4 vs exact diff |

---

## 5. Acceptance Criteria

- [ ] `TiktokenTokenizer.count` matches the committed gold corpus exactly (0 error) across code/prose/symbol/CJK/whitespace fixtures.
- [ ] `truncate(text, n)` returns ≤ n tokens and never splits a surrogate pair (round-trip test).
- [ ] `resolveContext` uses the exact tokenizer for `max_tokens` budget decisions (test: a string counted exactly, the snapshot's `total_tokens` equals the tokenizer's count, not `chars/4`.
- [ ] The budget trimmer's priority rules are unchanged — a fixture where `chars/4` would drop a target-adjacent file but exact counting keeps it (regression test).
- [ ] `grep -rn "chars/4\|Math.floor(.*length / 4" packages/context-engine/src` returns zero (approximation fully removed).
- [ ] Validation gate re-runs green with exact counts; no fixture exceeds budget post-swap.
- [ ] `pnpm --filter @harness/context-engine test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **The swap changes *budgets*, and that can change *behavior*.** `chars/4` over-counts code, so exact counts free budget — meaning some tasks now receive *more* context than Phase-1 did. That's a real (intended) behavior change; call it out in the token report, don't let it show up as an unexplained diff in Week 5's metrics.
- **Never count tokens with a global default.** The encoding differs by model family; using `cl100k_base` for a model that needs `o200k_base` silently mis-counts. Resolution must be per-request from `modelConfig.model`.
- **`truncate` must be encode→slice→decode, not `substring`.** Naive string slicing can cut a multi-byte codepoint in half and produce invalid output. The round-trip test exists to catch exactly this.
- **Token fidelity is about the *unit*, not the *encoder's* correctness.** The encoder is reference-grade; the bugs to catch are in the wiring (did the trimmer actually switch? does the gate use the new count?). Don't spend the day re-validating tiktoken itself.
- **Budget headroom is not a license to dump context.** More headroom ≠ "put more in"; the priority rules still govern selection. Exact counts make trimming *accurate*, not *greedy*.
- **Next (Day 20):** context cache keyed by `source_id + content_hash` with TTL/invalidation — and the Week-4 checkpoint, where the semantic shadow must be demonstrable end-to-end.

---

*Prev: [Day 18 — Semantic Retriever in Shadow, Behind the `Retriever`/`Ranker` Seam](day-18.md) | Next: [Day 20 — Context Cache: `source_id + content_hash`, TTL & Freshness (+ Week 4 Checkpoint)](day-20.md)*
