/**
 * Exact tokenizer (day-19 §2.1) — tiktoken behind the {@link Tokenizer} seam,
 * replacing the Phase-1 `chars/4` approximation. Counts come from the reference
 * byte-level BPE encoder, so budget decisions are now in the model's own unit
 * (§6: the *unit* is exact; the encoder itself is reference-grade and is not
 * re-validated here).
 *
 * `truncate` is encode → slice → decode, never `substring` (§6 pitfall): raw
 * string slicing can cut a multi-byte codepoint in half. Byte-level decode of a
 * token prefix yields a clean prefix instead — and when the cut lands mid-UTF-8,
 * decode emits a trailing U+FFFD replacement char, which we back off token by
 * token to the last clean boundary so the result never splits a surrogate pair.
 */

import { Tiktoken } from 'js-tiktoken/lite';
import type { TiktokenBPE } from 'js-tiktoken/lite';
import cl100k_base from 'js-tiktoken/ranks/cl100k_base';
import gpt2 from 'js-tiktoken/ranks/gpt2';
import o200k_base from 'js-tiktoken/ranks/o200k_base';
import p50k_base from 'js-tiktoken/ranks/p50k_base';
import p50k_edit from 'js-tiktoken/ranks/p50k_edit';
import r50k_base from 'js-tiktoken/ranks/r50k_base';

import type { Tokenizer } from './types.js';

/** The encodings js-tiktoken can resolve and this package ships locally. */
export type TiktokenEncodingName =
  'gpt2' | 'r50k_base' | 'p50k_base' | 'p50k_edit' | 'cl100k_base' | 'o200k_base';

/** Statically linked rank tables — no runtime network fetch (§1 deterministic). */
const RANKS: Record<TiktokenEncodingName, TiktokenBPE> = {
  gpt2,
  r50k_base,
  p50k_base,
  p50k_edit,
  cl100k_base,
  o200k_base,
};

export class TiktokenTokenizer implements Tokenizer {
  /** Snapshot provenance (`tiktoken:cl100k_base`), recorded by the engine §6. */
  readonly name: string;

  private readonly encoder: Tiktoken;

  constructor(encoding: TiktokenEncodingName = 'cl100k_base') {
    this.encoder = new Tiktoken(RANKS[encoding]);
    this.name = `tiktoken:${encoding}`;
  }

  count(text: string): number {
    return this.encoder.encode(text).length;
  }

  truncate(text: string, maxTokens: number): string {
    if (maxTokens <= 0) return '';
    const tokens = this.encoder.encode(text);
    if (tokens.length <= maxTokens) return text;

    let remaining = maxTokens;
    let result = this.encoder.decode(tokens.slice(0, remaining));
    // A cut midway through a multi-byte code point decodes to a trailing U+FFFD;
    // drop the partial token(s) until the prefix ends on a clean UTF-8 boundary.
    while (result.endsWith('�') && remaining > 0) {
      remaining -= 1;
      result = this.encoder.decode(tokens.slice(0, remaining));
    }
    return result;
  }
}
