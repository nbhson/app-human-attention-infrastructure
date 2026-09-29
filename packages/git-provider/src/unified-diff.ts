/**
 * Minimal unified-diff parser (Phase 3, Bitbucket path).
 *
 * The `bitbucket-mcp` get-files tool (`getPullRequestDiff`) returns the raw
 * unified diff text — not a JSON file list — so the MCP mapper needs a way to
 * split it back into per-file entries. This parser turns each
 * `diff --git` block into a {@link PullRequestFile}: the path (with `a/`/`b/`
 * prefixes stripped), the status (inferred from `/dev/null` / rename markers),
 * the added/removed line counts, and the block itself as the `patch` the
 * reviewer prompt consumes.
 *
 * Anything unparseable is a loud {@link GitProviderError} — a review that sees
 * "no files changed" must never be a silently-mangled mapping (day-03 §6).
 */

import type { PullRequestFile } from '@harness/domain';

import { GitProviderError } from './git-provider.js';

function stripPrefix(path: string): string {
  if (path.startsWith('a/') || path.startsWith('b/')) {
    return path.slice(2);
  }
  // Quoted paths (spaces/unicode) arrive as "a/sp ace.ts" — unquote minimally.
  if (path.startsWith('"') && path.endsWith('"')) {
    return stripPrefix(path.slice(1, -1));
  }
  return path;
}

/**
 * Parse raw unified diff text into per-file entries. Throws when the text
 * carries no recognisable file block.
 */
export function parseUnifiedDiff(text: string): PullRequestFile[] {
  const lines = text.split('\n');
  // A file block starts at `diff --git` — or, for terse diffs, at the first
  // `--- ` line when no block is open yet.
  const starts: number[] = [];
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      starts.push(i);
      open = true;
    } else if (!open && line.startsWith('--- ')) {
      starts.push(i);
      open = true;
    }
  }
  if (starts.length === 0) {
    throw new GitProviderError('get-files tool: no unified-diff file blocks found');
  }

  const files: PullRequestFile[] = [];
  for (let b = 0; b < starts.length; b++) {
    const block = lines.slice(starts[b]!, b + 1 < starts.length ? starts[b + 1]! : undefined);
    const file = parseBlock(block);
    if (file !== undefined) {
      files.push(file);
    }
  }
  if (files.length === 0) {
    throw new GitProviderError('get-files tool: no unified-diff file blocks found');
  }
  return files;
}

function parseBlock(block: string[]): PullRequestFile | undefined {
  let oldPath: string | undefined;
  let newPath: string | undefined;
  let renamedFrom: string | undefined;
  let renamedTo: string | undefined;
  let binary = false;
  let binaryNew = false;
  let additions = 0;
  let deletions = 0;

  for (const line of block) {
    if (line.startsWith('--- ')) {
      oldPath = line.slice(4).trim();
    } else if (line.startsWith('+++ ')) {
      newPath = line.slice(4).trim();
    } else if (line.startsWith('rename from ')) {
      renamedFrom = line.slice('rename from '.length).trim();
    } else if (line.startsWith('rename to ')) {
      renamedTo = line.slice('rename to '.length).trim();
    } else if (line.startsWith('Binary files ') && line.includes(' differ')) {
      binary = true;
      // "Binary files /dev/null and b/x differ" → new file;
      // "Binary files a/x and /dev/null differ" → deleted file.
      binaryNew = line.startsWith('Binary files /dev/null');
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
    }
  }

  // Fall back to the `diff --git a/x b/y` header when ---/+++ are absent.
  if ((oldPath === undefined || newPath === undefined) && block[0] !== undefined) {
    const m = /^diff --git (\S+) (\S+)/.exec(block[0]);
    if (m) {
      oldPath ??= m[1];
      newPath ??= m[2];
    }
  }

  const from = renamedFrom ?? oldPath;
  const to = renamedTo ?? newPath;
  if (from === undefined && to === undefined) {
    return undefined;
  }

  const isNew = from === '/dev/null' || (binary && binaryNew);
  const isDeleted = to === '/dev/null' || (binary && !binaryNew);
  const rawPath = isNew ? to : isDeleted ? from : (to ?? from);
  if (rawPath === undefined) {
    return undefined;
  }
  const path = stripPrefix(rawPath);
  const status =
    renamedFrom !== undefined || renamedTo !== undefined
      ? 'RENAMED'
      : isNew
        ? 'CREATED'
        : isDeleted
          ? 'DELETED'
          : 'MODIFIED';

  return {
    path,
    status,
    additions,
    deletions,
    patch: binary ? '' : block.join('\n').trim(),
  };
}
