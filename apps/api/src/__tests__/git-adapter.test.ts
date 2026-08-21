/**
 * `ShellGitAdapter` test (day-24 §3.1) — real git in a temp worktree. Proves the
 * adapter applies snapshot files into a clean tree, commits them, and returns the
 * SHA; and that a dirty tree is refused before any file is written ("no partial
 * commit").
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { MergeConflictError, ShellGitAdapter } from '../services/git-adapter.js';

const execFileP = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd });
  return stdout;
}

/** Initialise a fresh repo with a clean, committed README (requires git on PATH). */
async function initCleanRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'harness-git-'));
  await git(dir, ['init']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'user.name', 'Harness Test']);
  await git(dir, ['config', 'commit.gpgSign', 'false']);
  writeFileSync(join(dir, 'README.md'), '# hello\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', 'initial']);
  return dir;
}

describe('ShellGitAdapter', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies snapshot contents and commits them, returning the SHA', async () => {
    dir = await initCleanRepo();

    const adapter = new ShellGitAdapter(dir);
    const sha = await adapter.applyAndCommit(
      [{ filePath: 'src/app.ts', content: 'export const x = 1;\n' }],
      { message: 'harness: task t1' },
    );

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect((await git(dir, ['log', '--format=%s', '-1'])).trim()).toBe('harness: task t1');
  });

  it('refuses to commit on a dirty work tree', async () => {
    dir = await initCleanRepo();
    writeFileSync(join(dir, 'README.md'), '# changed\n');

    const adapter = new ShellGitAdapter(dir);
    await expect(
      adapter.applyAndCommit([{ filePath: 'src/app.ts', content: 'x\n' }], { message: 'm' }),
    ).rejects.toBeInstanceOf(MergeConflictError);

    // Nothing was written, so the tree should still carry only the pre-existing change.
    const status = await git(dir, ['status', '--porcelain']);
    expect(status).toContain('README.md');
    expect(status).not.toContain('src/app.ts');
  });
});
