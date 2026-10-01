-- Model-thinking control: per-review reasoning budget for reasoning-capable
-- models (`reasoning_effort` on Ollama's OpenAI-compatible endpoint). Nullable
-- text holding 'low' / 'off' (or NULL = model default, the pre-migration
-- behaviour). Wired to the Triage Rules page setting and forwarded to every
-- review + triage-summary LLM call.
ALTER TABLE "triage_rules" ADD COLUMN "reasoning_effort" text;
