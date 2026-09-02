import { describe, expect, it } from 'vitest';

import { extractFileReferences, tokenize } from '../tokenizer.js';
import { TiktokenTokenizer } from '../tiktoken-tokenizer.js';
import { getTokenizer } from '../tokenizer-registry.js';
import { GOLD_CORPUS } from './gold-corpus.js';

describe('TiktokenTokenizer (day-19 §2.2)', () => {
  const tokenizer = new TiktokenTokenizer('cl100k_base');

  it('matches the committed gold corpus exactly (0 error)', () => {
    for (const { text, tokens, rationale } of GOLD_CORPUS) {
      expect(tokenizer.count(text), rationale).toBe(tokens);
    }
  });

  it('counts empty text as zero tokens', () => {
    expect(tokenizer.count('')).toBe(0);
  });

  it('records the encoding in its provenance name', () => {
    expect(tokenizer.name).toBe('tiktoken:cl100k_base');
  });
});

describe('TiktokenTokenizer.truncate (day-19 §5)', () => {
  const tokenizer = new TiktokenTokenizer('cl100k_base');

  it('returns at most maxTokens tokens and never splits a surrogate pair', () => {
    for (const { text } of GOLD_CORPUS) {
      for (const n of [1, 2, 3, 5]) {
        const result = tokenizer.truncate(text, n);
        // ≤ n tokens …
        expect(tokenizer.count(result)).toBeLessThanOrEqual(n);
        // … a valid prefix (not cut mid-codepoint: no replacement char) …
        expect(text.startsWith(result)).toBe(true);
        expect(result.includes('�')).toBe(false);
      }
    }
  });

  it('truncates emoji on a clean boundary', () => {
    // 7 tokens; a 3-token cut lands inside the second emoji, which must back off
    // to the first complete emoji (2 tokens) rather than emit a lone surrogate.
    expect(tokenizer.truncate('💡🚀 emoji tokens', 3)).toBe('💡');
  });

  it('returns the full text when it already fits', () => {
    expect(tokenizer.truncate('Hello, world!', 4)).toBe('Hello, world!');
    expect(tokenizer.truncate('Hello, world!', 100)).toBe('Hello, world!');
  });

  it('returns the empty string for a non-positive budget', () => {
    expect(tokenizer.truncate('anything', 0)).toBe('');
    expect(tokenizer.truncate('anything', -1)).toBe('');
  });
});

describe('getTokenizer (day-19 §2.1 model-aware resolution)', () => {
  it('resolves the correct encoding per model family', () => {
    expect(getTokenizer('gpt-4').name).toBe('tiktoken:cl100k_base');
    expect(getTokenizer('gpt-4o').name).toBe('tiktoken:o200k_base');
    expect(getTokenizer('o3-mini').name).toBe('tiktoken:o200k_base');
  });

  it('falls back to cl100k_base for unknown models', () => {
    expect(getTokenizer('claude-3-5-sonnet').name).toBe('tiktoken:cl100k_base');
    expect(getTokenizer('my-custom-model').name).toBe('tiktoken:cl100k_base');
  });

  it('defaults to cl100k_base when no model is given', () => {
    expect(getTokenizer().name).toBe('tiktoken:cl100k_base');
  });
});

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric boundaries', () => {
    expect(tokenize('Fix bug in PaymentService.ts')).toEqual(new Set(['bug', 'paymentservice', 'ts']));
  });

  it('drops stopwords and duplicates', () => {
    expect(tokenize('the the fix add update')).toEqual(new Set());
  });

  it('keeps the salient keywords of a no-target task', () => {
    expect(tokenize('Add logging to all API endpoints')).toEqual(new Set(['logging', 'api', 'endpoints']));
  });
});

describe('extractFileReferences', () => {
  it('extracts source-file tokens from a task description', () => {
    expect(extractFileReferences('Fix bug in src/PaymentService.ts')).toEqual(['src/PaymentService.ts']);
  });

  it('returns an empty list when no file is named', () => {
    expect(extractFileReferences('add logging to all endpoints')).toEqual([]);
  });
});
