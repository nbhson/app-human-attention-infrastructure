import { describe, expect, it } from 'vitest';

import { ContextEngine, FileCollector, KeywordDependencyRanker, TiktokenTokenizer } from './index.js';

describe('@harness/context-engine public surface', () => {
  it('exports the engine and its collaborators', () => {
    expect(typeof TiktokenTokenizer).toBe('function');
    expect(typeof FileCollector).toBe('function');
    expect(typeof KeywordDependencyRanker).toBe('function');
    expect(typeof ContextEngine).toBe('function');
  });
});
