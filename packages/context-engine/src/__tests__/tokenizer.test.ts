import { describe, expect, it } from 'vitest';

import { extractFileReferences, tokenize } from '../tokenizer.js';
import { ApproxTokenizer } from '../types.js';

describe('ApproxTokenizer', () => {
  const tokenizer = new ApproxTokenizer();

  it('estimates tokens as chars / 4', () => {
    expect(tokenizer.count('abcd')).toBe(1);
    expect(tokenizer.count('abc')).toBe(1); // ceil
    expect(tokenizer.count('12345678')).toBe(2);
    expect(tokenizer.count('123456789')).toBe(3);
  });

  it('counts empty text as zero tokens', () => {
    expect(tokenizer.count('')).toBe(0);
  });
});

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric boundaries', () => {
    expect(tokenize('Fix bug in PaymentService.ts')).toEqual(
      new Set(['bug', 'paymentservice', 'ts']),
    );
  });

  it('drops stopwords and duplicates', () => {
    expect(tokenize('the the fix add update')).toEqual(new Set());
  });

  it('keeps the salient keywords of a no-target task', () => {
    expect(tokenize('Add logging to all API endpoints')).toEqual(
      new Set(['logging', 'api', 'endpoints']),
    );
  });
});

describe('extractFileReferences', () => {
  it('extracts source-file tokens from a task description', () => {
    expect(extractFileReferences('Fix bug in src/PaymentService.ts')).toEqual([
      'src/PaymentService.ts',
    ]);
  });

  it('returns an empty list when no file is named', () => {
    expect(extractFileReferences('add logging to all endpoints')).toEqual([]);
  });
});
