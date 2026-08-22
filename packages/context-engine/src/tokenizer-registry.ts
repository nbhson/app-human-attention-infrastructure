/**
 * Per-model tokenizer resolution (day-19 §2.1, §6) — budgets are interpreted in
 * the tokenizer of the *target model*, never a global constant. Unknown models
 * fall back to `cl100k_base` (the common default for the GPT-4 / embeddings
 * family and the encoding the committed gold corpus is measured against).
 */

import { getEncodingNameForModel } from 'js-tiktoken/lite';
import type { TiktokenModel } from 'js-tiktoken/lite';

import { TiktokenTokenizer } from './tiktoken-tokenizer.js';
import type { TiktokenEncodingName } from './tiktoken-tokenizer.js';

/** Default encoding when no model is given or the model is unknown. */
export const DEFAULT_ENCODING: TiktokenEncodingName = 'cl100k_base';

/**
 * Resolve the exact tokenizer for a model id. `getEncodingNameForModel` throws
 * "Unknown model" for ids outside js-tiktoken's table (e.g. Claude models), so
 * the lookup is guarded and falls back to {@link DEFAULT_ENCODING}.
 */
export function getTokenizer(model?: string): TiktokenTokenizer {
  if (!model) {
    return new TiktokenTokenizer(DEFAULT_ENCODING);
  }
  try {
    const encoding = getEncodingNameForModel(model as TiktokenModel);
    return new TiktokenTokenizer(encoding);
  } catch {
    return new TiktokenTokenizer(DEFAULT_ENCODING);
  }
}
