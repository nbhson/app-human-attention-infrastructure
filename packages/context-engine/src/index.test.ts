import { describe, expect, it } from 'vitest';

import { ApproxTokenizer, ContextEngine, FileCollector, KeywordDependencyRanker } from './index.js';

describe('@harness/context-engine public surface', () => {
  it('exports the engine and its collaborators', () => {
    expect(typeof ApproxTokenizer).toBe('function');
    expect(typeof FileCollector).toBe('function');
    expect(typeof KeywordDependencyRanker).toBe('function');
    expect(typeof ContextEngine).toBe('function');
  });
});
