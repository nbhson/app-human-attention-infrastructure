import { describe, expect, it } from 'vitest';

import { PullRequestFileStatus } from '@harness/domain';
import type { PullRequestFile } from '@harness/domain';

import { buildDiff } from '../services/review-ingest.js';
import { isGeneratedFile, isReviewableFile, isSourceFile } from '../review-file-classify.js';

function file(path: string, patch = '--- a/x\n+++ b/x\n'): PullRequestFile {
  return { path, status: PullRequestFileStatus.Modified, additions: 1, deletions: 0, patch };
}

describe('buildDiff', () => {
  it('keeps every hand-written file — source, docs, config and infra — and drops only generated artifacts', () => {
    const files = [
      file('package-lock.json'),
      file('node_modules/.bin/ng'),
      file('dist/toeic-app/browser/chunk-B3-J63dS.js'),
      file('src/main.ts.map'),
      file('assets/app.min.js'),
      file('src/app.ts'),
      file('src/app.component.scss'),
      file('Dockerfile'),
      file('README.md'),
      file('package.json'),
      file('docker-compose.yml'),
      file('.env'),
    ];

    const diff = buildDiff(files);

    expect(diff).toContain('src/app.ts');
    expect(diff).toContain('src/app.component.scss');
    expect(diff).toContain('Dockerfile');
    expect(diff).toContain('README.md');
    expect(diff).toContain('package.json');
    expect(diff).toContain('docker-compose.yml');
    expect(diff).toContain('.env');
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

  it('redacts secret values from .env patches before they reach the diff', () => {
    const files = [
      file('.env', '--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n+API_KEY=sk-live-abc\n+PORT=3000\n'),
    ];

    const diff = buildDiff(files);

    expect(diff).toContain('=== .env');
    expect(diff).toContain('+API_KEY=<redacted>');
    expect(diff).toContain('+PORT=3000');
    expect(diff).not.toContain('sk-live-abc');
  });
});

describe('isGeneratedFile', () => {
  it('rejects lockfiles by basename regardless of directory', () => {
    expect(isGeneratedFile('package-lock.json')).toBe(true);
    expect(isGeneratedFile('sub/pkg/yarn.lock')).toBe(true);
  });

  it('rejects build output and source maps by path', () => {
    expect(isGeneratedFile('node_modules/.bin/ng')).toBe(true);
    expect(isGeneratedFile('dist/app/chunk.js')).toBe(true);
    expect(isGeneratedFile('src/app.ts.map')).toBe(true);
  });

  it('accepts ordinary source and config files', () => {
    expect(isGeneratedFile('src/app.ts')).toBe(false);
    expect(isGeneratedFile('Dockerfile')).toBe(false);
    expect(isGeneratedFile('package.json')).toBe(false);
  });
});

describe('isReviewableFile', () => {
  it('is true for every hand-written file — source, docs, config and infra', () => {
    expect(isReviewableFile('src/app.ts')).toBe(true);
    expect(isReviewableFile('README.md')).toBe(true);
    expect(isReviewableFile('package.json')).toBe(true);
    expect(isReviewableFile('Dockerfile')).toBe(true);
    expect(isReviewableFile('docker-compose.yml')).toBe(true);
    expect(isReviewableFile('.env')).toBe(true);
  });

  it('is false for a generated artifact', () => {
    expect(isReviewableFile('package-lock.json')).toBe(false);
    expect(isReviewableFile('node_modules/.bin/ng')).toBe(false);
    expect(isReviewableFile('dist/app/chunk.js')).toBe(false);
    expect(isReviewableFile('src/app.ts.map')).toBe(false);
    expect(isReviewableFile('assets/app.min.js')).toBe(false);
  });
});

describe('isSourceFile', () => {
  it('accepts only hand-written programming/web source', () => {
    expect(isSourceFile('src/app.ts')).toBe(true);
    expect(isSourceFile('src/App.tsx')).toBe(true);
    expect(isSourceFile('src/toeic.service.ts')).toBe(true);
  });

  it('rejects generated, doc, config and infra files', () => {
    expect(isSourceFile('package-lock.json')).toBe(false);
    expect(isSourceFile('node_modules/.bin/ng')).toBe(false);
    expect(isSourceFile('dist/app/chunk.js')).toBe(false);
    expect(isSourceFile('README.md')).toBe(false);
    expect(isSourceFile('Dockerfile')).toBe(false);
    expect(isSourceFile('nginx.conf')).toBe(false);
    expect(isSourceFile('package.json')).toBe(false);
    expect(isSourceFile('tsconfig.json')).toBe(false);
  });
});
