/**
 * Workspace manifest (day-22 §3.3 "attributability") — walks a worktree and
 * computes a per-file SHA-256 manifest plus an aggregate content hash.
 *
 * A verification result is only meaningful when the exact bytes it verified are
 * identified by `content_hash` (Spec 7 §5.5). The manifest is deterministic
 * (files sorted by path) and skips the noise that verification itself produces
 * (or that never constitutes "the change under review"): dependency trees,
 * VCS metadata, build output, and the Vitest reporter's output file.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { SandboxWorkdirFile } from './sandbox.js';

/** Directories that are never part of the verified bytes. */
const IGNORED_DIRS = new Set(['node_modules', '.git', '.turbo', 'dist']);

/** Files produced by tooling or the verify step, not by the change under review. */
const IGNORED_FILES = new Set(['.vitest-out.json', '.DS_Store']);

/** A computed manifest: per-file hashes + the aggregate content hash. */
export interface WorkdirManifest {
  /** Per-file identities, sorted by path for determinism. */
  readonly files: SandboxWorkdirFile[];
  /** Aggregate SHA-256 over the sorted file list (the `content_hash`). */
  readonly contentHash: string;
}

async function walk(dir: string, root: string, files: SandboxWorkdirFile[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable/missing directory: skip it, attribution stays partial
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walk(join(dir, entry.name), root, files);
      }
      continue;
    }
    // Symlinks, sockets and other special files are not "verified bytes".
    if (!entry.isFile() || IGNORED_FILES.has(entry.name)) {
      continue;
    }
    const bytes = await readFile(join(dir, entry.name));
    files.push({
      path: relative(root, join(dir, entry.name)).split('\\').join('/'),
      contentHash: createHash('sha256').update(bytes).digest('hex'),
    });
  }
}

/**
 * Compute the manifest of `workdirPath`. A missing or unreadable worktree yields
 * an empty manifest (that change has nothing to attribute yet) — never a throw
 * that would fail the whole verification request.
 */
export async function computeWorkdirManifest(workdirPath: string): Promise<WorkdirManifest> {
  const files: SandboxWorkdirFile[] = [];
  await walk(workdirPath, workdirPath, files);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const aggregate = createHash('sha256');
  for (const file of files) {
    aggregate.update(file.path);
    aggregate.update('\0');
    aggregate.update(file.contentHash);
    aggregate.update('\0');
  }
  return { files, contentHash: aggregate.digest('hex') };
}
