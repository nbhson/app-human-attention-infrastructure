/**
 * The `LLMProvider` seam (day-11 §2.1), exposed from `@harness/agent-runtime`.
 *
 * The canonical type definitions moved to `@harness/domain` on day-21 §2.4 — the
 * review-quality judge (`@harness/judge`) must call the seam without importing a
 * sibling engine (boundary R4), and the seam is a pure contract, so it belongs on
 * the shared contract package. This file re-exports them so `@harness/agent-runtime`
 * keeps its public surface (and the boundary linter's promise that
 * `@anthropic-ai/sdk` never leaks past this package) intact.
 */

export type { LLMMessage, LLMProvider, LLMRequest, LLMResponse, LLMToolCall, LLMToolDefinition } from '@harness/domain';
