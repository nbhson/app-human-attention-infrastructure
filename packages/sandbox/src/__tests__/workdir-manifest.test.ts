import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeWorkdirManifest } from '../workdir-manifest.js';

function makeWorkdir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'workdir-manifest-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(join(dir, 'tsconfig.json'), '{ "compilerOptions": {} }\n');
  // Noise that must never be part of the verified bytes.
  mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'ignored');
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
  writeFileSync(join(dir, '.DS_Store'), 'ignored');
  writeFileSync(join(dir, '.vitest-out.json'), '{}');
  return dir;
}

describe('computeWorkdirManifest (day-22 §3.3)', () => {
  it('hashes only real source files, sorted by path, skipping tooling noise', async () => {
    const dir = makeWorkdir();
    const manifest = await computeWorkdirManifest(dir);

    expect(manifest.files.map((file) => file.path)).toEqual(['src/index.ts', 'tsconfig.json']);
    const indexTs = manifest.files[0];
    expect(indexTs?.contentHash).toBe(createHash('sha256').update('export const x = 1;\n').digest('hex'));
    rmSync(dir, { recursive: true, force: true });
  });

  it('is deterministic across runs', async () => {
    const dir = makeWorkdir();
    const first = await computeWorkdirManifest(dir);
    const second = await computeWorkdirManifest(dir);
    expect(second).toEqual(first);
    rmSync(dir, { recursive: true, force: true });
  });

  it('changes the aggregate content_hash when a byte changes', async () => {
    const dir = makeWorkdir();
    const before = await computeWorkdirManifest(dir);

    writeFileSync(join(dir, 'src', 'index.ts'), 'export const x = 2;\n');
    const after = await computeWorkdirManifest(dir);

    expect(after.contentHash).not.toBe(before.contentHash);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty manifest for a missing worktree (never throws)', async () => {
    const manifest = await computeWorkdirManifest(join(tmpdir(), 'does-not-exist-xyz'));
    expect(manifest.files).toEqual([]);
    expect(manifest.contentHash).toBe(createHash('sha256').digest('hex'));
  });
});
