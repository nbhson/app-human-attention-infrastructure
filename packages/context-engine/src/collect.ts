/**
 * FileCollector (day-20 §2.2) — walks the project root for eligible candidates.
 *
 * Hard exclusions so a snapshot never swallows dependencies or binaries:
 * `node_modules`, `.git`, `dist`, `build`; binary/lock suffixes; files > 256 KB.
 * Every read goes through {@link resolveSafe}, so the collector cannot escape
 * the root (the same credential-leak guard as the Day-13 file tools, §6).
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

import { resolveSafe } from './resolve-safe.js';

/** Directory names the collector never descends into (day-20 §2.2). */
export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.turbo',
  'coverage',
  '.next',
]);

/** Binary / non-source suffixes dropped from the candidate set (day-20 §6). */
export const EXCLUDED_SUFFIXES: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.wasm',
  '.lock',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.tgz',
  '.exe',
  '.so',
  '.dylib',
  '.dll',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.bin',
  '.map',
  '.lockb',
];

/** Whole-file names that are never source (lockfiles, day-20 §6). */
const LOCKFILE_NAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

/** Maximum source size before a file is dropped outright (day-20 §2.2). */
export const MAX_FILE_SIZE_BYTES = 256 * 1024;

/** One eligible file: its repo-relative path (posix separators) and raw content. */
export interface CollectedFile {
  readonly sourceId: string;
  readonly content: string;
}

/** Should `sourceId` (repo-relative, posix separators) be excluded? */
export function isExcludedPath(sourceId: string): boolean {
  const lower = sourceId.toLowerCase();
  const segments = lower.split('/');
  if (segments.some((segment) => EXCLUDED_DIRS.has(segment))) return true;
  const base = segments[segments.length - 1];
  if (base !== undefined && LOCKFILE_NAMES.has(base)) return true;
  return EXCLUDED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export class FileCollector {
  constructor(private readonly rootDir: string) {}

  /** Walk the root and return every eligible candidate (deterministic order). */
  async collect(): Promise<CollectedFile[]> {
    const files: CollectedFile[] = [];
    await this.walk('', files);
    return files;
  }

  private async walk(relDir: string, out: CollectedFile[]): Promise<void> {
    const absDir =
      relDir === '' ? resolveSafe(this.rootDir, '.') : resolveSafe(this.rootDir, relDir);
    const entries = await readdir(absDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relPath = relDir === '' ? entry.name : join(relDir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        await this.walk(relPath, out);
        continue;
      }
      // Symlinks and special files are neither files nor directories here, so
      // they are skipped — the collector never follows a symlink out of the root.
      if (!entry.isFile()) continue;

      const sourceId = relPath.split(sep).join('/');
      if (isExcludedPath(sourceId)) continue;

      const absPath = resolveSafe(this.rootDir, relPath);
      const info = await stat(absPath);
      if (info.size > MAX_FILE_SIZE_BYTES) continue;

      const content = await readFile(absPath, 'utf8');
      out.push({ sourceId, content });
    }
  }
}
