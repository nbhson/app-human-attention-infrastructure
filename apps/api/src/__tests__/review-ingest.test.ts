import { describe, expect, it } from 'vitest';

import { PullRequestFileStatus } from '@harness/domain';
import type { PullRequestFile } from '@harness/domain';

import { buildDiff, isReviewableFile } from '../services/review-ingest.js';

function file(path: string, patch = '--- a/x\n+++ b/x\n'): PullRequestFile {
  return { path, status: PullRequestFileStatus.Modified, additions: 1, deletions: 0, patch };
}

describe('buildDiff', () => {
  it('skips generated/dependency files and keeps hand-written source', () => {
    const files = [
      file('package-lock.json'),
      file('node_modules/.bin/ng'),
      file('dist/toeic-app/browser/chunk-B3-J63dS.js'),
      file('src/main.ts.map'),
      file('assets/app.min.js'),
      file('src/app.ts'),
      file('Dockerfile'),
    ];

    const diff = buildDiff(files);

    expect(diff).toContain('src/app.ts');
    expect(diff).toContain('Dockerfile');
    expect(diff).not.toContain('package-lock.json');
    expect(diff).not.toContain('node_modules/.bin/ng');
    expect(diff).not.toContain('dist/toeic-app/browser/chunk-B3-J63dS.js');
    expect(diff).not.toContain('src/main.ts.map');
    expect(diff).not.toContain('assets/app.min.js');
  });

  it('drops files whose patch is empty (binaries and empty diffs)', () => {
    const files = [file('src/app.ts'), file('logo.png', '')];

    const diff = buildDiff(files);

    expect(diff).toContain('src/app.ts');
    expect(diff).not.toContain('logo.png');
  });
});

describe('isReviewableFile', () => {
  it('rejects lockfiles by basename regardless of directory', () => {
    expect(isReviewableFile('package-lock.json')).toBe(false);
    expect(isReviewableFile('sub/pkg/yarn.lock')).toBe(false);
  });

  it('rejects build output and source maps by path', () => {
    expect(isReviewableFile('node_modules/.bin/ng')).toBe(false);
    expect(isReviewableFile('dist/app/chunk.js')).toBe(false);
    expect(isReviewableFile('src/app.ts.map')).toBe(false);
  });

  it('accepts ordinary source and config files', () => {
    expect(isReviewableFile('src/app.ts')).toBe(true);
    expect(isReviewableFile('Dockerfile')).toBe(true);
    expect(isReviewableFile('package.json')).toBe(true);
  });
});
