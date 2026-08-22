/**
 * FileCollector (day-20 §2.2) — walks the project root for eligible candidates.
 *
 * Hard exclusions so a snapshot never swallows dependencies or binaries:
 * `node_modules`, `.git`, `dist`, `build`; binary/lock suffixes; files > 256 KB.
 * Every read goes through {@link resolveSafe}, so the collector cannot escape
 * the root (the same credential-leak guard as the Day-13 file tools, §6).
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join, sep } from 'node:path';

import { sha256 } from './freshness.js';
import type { ContextCache } from './cache/context-cache.js';
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
  /** Day-26 §3.4 single-flight: coalesce concurrent reads of one sourceId. */
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly rootDir: string,
    /** Read-optimization leaf (day-20 §2.1); omitted means always re-read. */
    private readonly cache?: ContextCache,
  ) {}

  /** The project root this collector reads from (exposed for freshness checks). */
  get root(): string {
    return this.rootDir;
  }

  /** Walk the root and return every eligible candidate (deterministic order). */
  async collect(): Promise<CollectedFile[]> {
    const files: CollectedFile[] = [];
    await this.walk('', files);
    return files;
  }

  /**
   * Re-read only the named paths (day-21 §2.1). Used by the STALE re-resolve
   * policy to patch just the sources that changed, leaving the rest untouched.
   * Missing / excluded / oversized / unreadable paths are silently omitted: the
   * caller keeps the previous snapshot entry (already flagged stale) in that case.
   */
  async collectPaths(paths: readonly string[]): Promise<CollectedFile[]> {
    const out: CollectedFile[] = [];
    for (const sourceId of paths) {
      if (isExcludedPath(sourceId)) continue;
      try {
        const absPath = resolveSafe(this.rootDir, sourceId);
        const content = await this.readSource(absPath, sourceId);
        if (content === null) continue;
        out.push({ sourceId, content });
      } catch {
        // vanished or unreadable — omitting keeps the stale entry flagged.
      }
    }
    return out;
  }

  /**
   * Read one eligible source through the cache (day-20 §5.1). The stat fast-path
   * serves a `(sourceId, mtime, size)` hit with zero file reads; a miss reads,
   * hashes (`sha256` — the truth, §2.2), and stores. Returns `null` when the
   * file is missing or oversized, so callers silently drop it.
   */
  private async readSource(absPath: string, sourceId: string): Promise<string | null> {
    const info = await stat(absPath);
    if (info.size > MAX_FILE_SIZE_BYTES) return null;

    if (this.cache) {
      const hit = await this.cache.getByStat(sourceId, info.mtimeMs, info.size);
      if (hit !== null) {
        return hit.content;
      }
    }

    // Day-26 §3.4 — single-flight the miss: concurrent collects of the same source
    // coalesce onto one read+set. The cache fast-path above is untouched, so a stat
    // hit still needs zero reads; only a genuine miss reaches the shared load.
    const existing = this.inFlight.get(sourceId);
    if (existing) {
      return existing;
    }
    const load = this.loadSource(absPath, sourceId, info);
    this.inFlight.set(sourceId, load);
    try {
      return await load;
    } finally {
      this.inFlight.delete(sourceId);
    }
  }

  /** The shared miss path: read the file, hash it, and store once per source. */
  private async loadSource(absPath: string, sourceId: string, info: Stats): Promise<string> {
    const content = await readFile(absPath, 'utf8');
    if (this.cache) {
      await this.cache.set({
        sourceId,
        contentHash: sha256(content),
        content,
        mtimeMs: info.mtimeMs,
        size: info.size,
      });
    }
    return content;
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
      const content = await this.readSource(absPath, sourceId);
      if (content === null) continue;

      out.push({ sourceId, content });
    }
  }
}
