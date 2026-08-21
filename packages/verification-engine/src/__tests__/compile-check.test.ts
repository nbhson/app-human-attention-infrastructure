import { fileURLToPath } from 'node:url';

import { brand } from '@harness/domain';
import { describe, expect, it } from 'vitest';

import { CompileCheck } from '../checks/compile-check.js';
import { CheckKind, CheckStatus } from '../types.js';
import type { CheckContext } from '../types.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));

function context(worktreePath: string): CheckContext {
  return {
    changeId: brand('change-1', 'ChangeID'),
    worktreePath,
    sandboxRoot: FIXTURES,
  };
}

describe('CompileCheck', () => {
  it('passes a worktree that type-checks', async () => {
    const result = await new CompileCheck(60_000).run(context(`${FIXTURES}/compile-pass`));
    expect(result.checkKind).toBe(CheckKind.COMPILE);
    expect(result.status).toBe(CheckStatus.PASSED);
  });

  it('fails a broken worktree and surfaces the tsc diagnostics', async () => {
    const result = await new CompileCheck(60_000).run(context(`${FIXTURES}/compile-fail`));
    expect(result.status).toBe(CheckStatus.FAILED);
    expect(result.output).toContain('TS2322');
  });
});
