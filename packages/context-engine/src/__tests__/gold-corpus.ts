/**
 * Committed known-count reference strings (cl100k_base), day-19 §2.2. The counts
 * below were produced by running the reference byte-level BPE encoder once and
 * are frozen here — the tokenizer must match them to within 0, because it *is*
 * that encoder. What the test proves is not the encoder, but the wiring: that the
 * seam exposes the exact counter (not `chars/4`) for budget decisions.
 */

export interface GoldCase {
  readonly text: string;
  readonly tokens: number;
  /** Why this case matters to the fidelity claim. */
  readonly rationale: string;
}

export const GOLD_CORPUS: readonly GoldCase[] = [
  { text: 'Hello, world!', tokens: 4, rationale: 'plain prose' },
  {
    text: 'export class PaymentService {\n  process() {\n    return "payment processed";\n  }\n}',
    tokens: 18,
    rationale: 'code: newlines, braces, quotes',
  },
  { text: '   \n\t  ', tokens: 2, rationale: 'whitespace-heavy' },
  { text: '你好，世界！', tokens: 7, rationale: 'CJK multi-byte' },
  {
    text: 'function f(x: number): number { return x + 1; }',
    tokens: 15,
    rationale: 'symbols and type annotation',
  },
  { text: '💡🚀 emoji tokens', tokens: 7, rationale: 'surrogate pairs' },
  {
    text: 'The quick brown fox jumps over the lazy dog.',
    tokens: 10,
    rationale: 'common-word sentence',
  },
];
