import { describe, expect, it } from 'vitest';

import { greeting } from './greeting';

describe('greeting', () => {
  it('greets with a lowercased name', () => {
    expect(greeting('ADA')).toBe('Hello, ada!');
  });
});
