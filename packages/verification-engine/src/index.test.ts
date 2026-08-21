import { describe, expect, it } from 'vitest';

import { CheckKind, CheckStatus, CompileCheck } from './index.js';

describe('@harness/verification-engine', () => {
  it('exports the public surface', () => {
    expect(CheckKind.COMPILE).toBe('COMPILE');
    expect(CheckStatus.PASSED).toBe('PASSED');
    const check = new CompileCheck(60_000);
    expect(check.kind).toBe(CheckKind.COMPILE);
    expect(check.timeoutMs).toBe(60_000);
  });
});
