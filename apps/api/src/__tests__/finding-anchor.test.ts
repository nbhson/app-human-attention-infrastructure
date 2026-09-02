import { describe, expect, it } from 'vitest';

import { computeFindingAnchor } from '../finding-anchor.js';

// A 7-line new-file hunk starting at line 10 (git `+10,7`): lines 10..16.
const PATCH = ['@@ -10,5 +10,7 @@ function foo() {', ' keep', '-  old', '+  new', ' keep', '}'].join('\n');

function payload(files: readonly { path: string; patch: string }[]): unknown {
  return { files };
}

describe('computeFindingAnchor', () => {
  it('verifies a line inside a changed hunk (new-file numbering)', () => {
    const anchor = computeFindingAnchor(payload([{ path: 'a.ts', patch: PATCH }]), 'a.ts', 10);
    expect(anchor.status).toBe('verified');
    expect(anchor.detail).toBe('line 10 is in this diff');
  });

  it('verifies the last line of the hunk range but not one past it', () => {
    expect(computeFindingAnchor(payload([{ path: 'a.ts', patch: PATCH }]), 'a.ts', 16).status).toBe('verified');
    expect(computeFindingAnchor(payload([{ path: 'a.ts', patch: PATCH }]), 'a.ts', 17).status).toBe('unverified');
  });

  it('flags a file that is not in the diff', () => {
    const anchor = computeFindingAnchor(payload([{ path: 'a.ts', patch: PATCH }]), 'b.ts', 10);
    expect(anchor.status).toBe('unverified');
    expect(anchor.detail).toBe('file not touched by this PR');
  });

  it('flags a finding with no line anchor', () => {
    const anchor = computeFindingAnchor(payload([{ path: 'a.ts', patch: PATCH }]), 'a.ts', null);
    expect(anchor.status).toBe('unverified');
    expect(anchor.detail).toBe('finding has no line anchor');
  });

  it('flags a file whose patch has no added lines (pure deletion)', () => {
    const deletionOnly = '@@ -5,3 +5,0 @@\n- removed\n- removed\n- removed';
    const anchor = computeFindingAnchor(payload([{ path: 'a.ts', patch: deletionOnly }]), 'a.ts', 5);
    expect(anchor.status).toBe('unverified');
  });

  it('flags a file with no diff hunks at all', () => {
    const anchor = computeFindingAnchor(payload([{ path: 'a.ts', patch: 'binary file' }]), 'a.ts', 1);
    expect(anchor.status).toBe('unverified');
    expect(anchor.detail).toBe('no parseable hunks in this file diff');
  });

  it('is safe against an empty pr_payload', () => {
    expect(computeFindingAnchor({}, 'a.ts', 10)).toEqual({
      status: 'unverified',
      detail: 'file not touched by this PR',
    });
  });
});
