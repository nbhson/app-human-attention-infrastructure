import { describe, expect, it } from 'vitest';

import { normalizePrFiles } from '../pr-files.js';

describe('normalizePrFiles', () => {
  it('flattens per-file metadata + patch into a stable shape', () => {
    const files = normalizePrFiles({
      files: [
        { path: 'a.ts', status: 'modified', additions: 3, deletions: 1, patch: '@@ ...' },
        { path: 'b.ts', status: 'added', additions: 10, deletions: 0, patch: '@@ ...' },
      ],
    });

    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({
      path: 'a.ts',
      status: 'modified',
      additions: 3,
      deletions: 1,
      patch: '@@ ...',
    });
    expect(files[1]?.status).toBe('added');
  });

  it('is safe against an empty pr_payload', () => {
    expect(normalizePrFiles({})).toEqual([]);
  });

  it('drops entries without a usable path', () => {
    expect(normalizePrFiles({ files: [{ status: 'added', patch: '' }] })).toEqual([]);
    expect(normalizePrFiles({ files: [{ path: '', patch: 'x' }] })).toEqual([]);
  });

  it('coerces missing or negative line counts to zero and patch to empty', () => {
    const [file] = normalizePrFiles({
      files: [{ path: 'a.ts', additions: -1, deletions: 'nope' }],
    });
    expect(file).toEqual({
      path: 'a.ts',
      status: 'unknown',
      additions: 0,
      deletions: 0,
      patch: '',
    });
  });

  it('returns an empty array when files is not an array', () => {
    expect(normalizePrFiles({ files: 'nope' })).toEqual([]);
    expect(normalizePrFiles(null)).toEqual([]);
  });
});
