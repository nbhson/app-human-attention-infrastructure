/**
 * `GitAdapter` (day-24 §3.1) — the *only* place the harness writes to a real git
 * repository.
 *
 * Git operations live in `apps/api` (R5: apps may import anything), never in
 * `packages/*`. The Day-14 ADR (`docs/architecture/artifact-tracker-vs-git.md`)
 * draws the boundary at the human merge: the Tracker owns everything before it,
 * Git owns everything after, and `changes.commit_sha` is the single join point.
 *
 * The adapter is deliberately narrow: it applies snapshot contents to a working
 * tree and commits them, returning the SHA. Conflict detection is conservative —
 * any pre-existing dirty state is a {@link MergeConflictError}, so the harness
 * never commits on top of someone else's edits.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** One file to commit: a repo-relative path and its full content. */
export interface ArtifactFile {
  readonly filePath: string;
  readonly content: string;
}

/** Commit metadata. */
export interface CommitOptions {
  readonly message: string;
}

/** The narrow git surface the merge step depends on (swappable for tests). */
export interface GitAdapter {
  /** Write every file and commit them, returning the resulting commit SHA. */
  applyAndCommit(files: readonly ArtifactFile[], options: CommitOptions): Promise<string>;
}

/** The working tree already had uncommitted changes — the merge must not proceed. */
export class MergeConflictError extends Error {
  constructor(workRoot: string) {
    super(`merge conflict: working tree "${workRoot}" is dirty`);
    this.name = 'MergeConflictError';
  }
}

/** A git command failed for a reason other than a dirty tree. */
export class GitCommitError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'GitCommitError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** The production adapter: shells out to the host `git` in the given work tree. */
export class ShellGitAdapter implements GitAdapter {
  constructor(private readonly workRoot: string) {}

  async applyAndCommit(files: readonly ArtifactFile[], options: CommitOptions): Promise<string> {
    // 1. Conflict detection: refuse to operate on a dirty tree (no partial commit).
    const status = await this.git(['status', '--porcelain']);
    if (status.trim().length > 0) {
      throw new MergeConflictError(this.workRoot);
    }

    // 2. Apply snapshot contents onto the work tree.
    for (const file of files) {
      this.writeFile(file.filePath, file.content);
    }

    // 3. Commit and return the SHA.
    await this.git(['add', '-A']);
    await this.git(['commit', '-m', options.message]);
    return (await this.git(['rev-parse', 'HEAD'])).trim();
  }

  /** Write `content` to `workRoot/filePath`, refusing to escape the work tree. */
  private writeFile(filePath: string, content: string): void {
    const absolute = resolve(this.workRoot, filePath);
    const root = this.workRoot.endsWith(sep) ? this.workRoot : `${this.workRoot}${sep}`;
    if (absolute !== this.workRoot && !absolute.startsWith(root)) {
      throw new GitCommitError(`refusing to write outside the work tree: ${filePath}`);
    }
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }

  /** Run a git command in the work tree; a non-zero exit is a {@link GitCommitError}. */
  private async git(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await execFileP('git', args as string[], { cwd: this.workRoot });
      return stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GitCommitError(`git ${args.join(' ')} failed: ${message}`, error);
    }
  }
}
