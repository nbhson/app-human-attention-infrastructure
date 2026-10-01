/**
 * Impact scope (reviewer-v9) — within-PR caller/call-site context for the AI reviewer.
 *
 * The reviewer only receives the PR diff, so a change to a shared function or
 * component looks locally safe while its callers break. This module derives a
 * cheap, deterministic approximation from the PR files themselves: for every
 * changed file, which *other changed files* appear to import it (`importedBy`)
 * and which files it imports (`imports`).
 *
 * This is explicitly a *within-PR* signal, not a whole-repo call graph:
 * usages outside the PR are unknown (the PR may be external with no local
 * checkout). The rendered section says so, and instructs the model to name
 * that assumption instead of inventing external callers.
 */

import type { PullRequestFile } from '@harness/domain';

/** One changed file's within-PR impact edges. */
export interface ImpactScopeEntry {
  /** Repo-relative path of the changed file. */
  readonly file: string;
  /** Other *changed* files that appear to import this file. */
  readonly importedBy: readonly string[];
  /** Changed files this file appears to import. */
  readonly imports: readonly string[];
}

/**
 * Build within-PR impact edges by scanning added lines for static
 * import/require specifiers and matching them (by basename, extension-insensitive)
 * against the other changed files. Dynamic `import(variable)` and aliased
 * package specifiers cannot be resolved here and are ignored — the section
 * renderer marks the result as partial for exactly this reason.
 */
export function buildImpactScope(files: readonly PullRequestFile[]): ImpactScopeEntry[] {
  const reviewable = files.filter((f) => f.patch.trim().length > 0);
  if (reviewable.length === 0) return [];

  const byBase = new Map<string, string[]>();
  for (const f of reviewable) {
    const base = basenameNoExt(f.path);
    if (base.length === 0) continue;
    const group = byBase.get(base) ?? [];
    group.push(f.path);
    byBase.set(base, group);
  }

  const importsOf = new Map<string, Set<string>>();
  for (const f of reviewable) {
    const found = new Set<string>();
    for (const spec of extractStaticSpecifiers(f.patch)) {
      const base = basenameNoExt(spec.split('?')[0] ?? '');
      if (base.length === 0) continue;
      for (const target of byBase.get(base) ?? []) {
        if (target !== f.path) found.add(target);
      }
    }
    importsOf.set(f.path, found);
  }

  const importedBy = new Map<string, Set<string>>();
  for (const f of reviewable) importedBy.set(f.path, new Set<string>());
  for (const [from, targets] of importsOf) {
    for (const target of targets) {
      importedBy.get(target)?.add(from);
    }
  }

  return reviewable.map((f) => ({
    file: f.path,
    importedBy: [...(importedBy.get(f.path) ?? [])].sort(),
    imports: [...(importsOf.get(f.path) ?? [])].sort(),
  }));
}

/**
 * Keep prompts small for multi-batch reviews: retain entries for the batch's
 * own files plus any entry that touches them as a caller or callee.
 */
export function filterImpactScopeForBatch(
  scope: readonly ImpactScopeEntry[],
  batchFiles: readonly string[],
): ImpactScopeEntry[] {
  if (scope.length === 0 || batchFiles.length === 0) return [...scope];
  const batch = new Set(batchFiles);
  return scope.filter(
    (e) => batch.has(e.file) || e.importedBy.some((f) => batch.has(f)) || e.imports.some((f) => batch.has(f)),
  );
}

/** Render the IMPACT SCOPE user-message section. Empty scope renders ''. */
export function buildImpactScopeSection(scope: readonly ImpactScopeEntry[] = []): string {
  const entries = scope.filter((e) => e.importedBy.length > 0 || e.imports.length > 0);
  const lines = [
    'IMPACT SCOPE (derived data — within-PR import edges only, may be partial):',
    'Use this to enumerate every visible impact point of a shared change. Callers',
    'outside this PR are NOT listed here — when a changed export could be used',
    'elsewhere, say so explicitly instead of inventing callers.',
    '',
  ];
  if (entries.length === 0) {
    lines.push(
      'No within-PR import edges detected (either no cross-file imports among the',
      'changed files, or only dynamic/aliased imports). Treat every shared export,',
      'hook, component, or config key as potentially used outside this diff.',
    );
    return lines.join('\n');
  }
  for (const e of entries) {
    lines.push(`  ${e.file}`);
    lines.push(
      `    imported by (in-PR callers): ${e.importedBy.length > 0 ? e.importedBy.join(', ') : '(none in PR)'}`,
    );
    lines.push(`    imports (in-PR deps): ${e.imports.length > 0 ? e.imports.join(', ') : '(none in PR)'}`);
  }
  lines.push('');
  lines.push(
    'Rules: when you change a shared symbol, list ALL entries above that can',
    'observe it (directly or transitively within the PR) in the finding message.',
    'When no entry covers a plausible external caller, state the assumption',
    '("No in-PR caller visible; external callers unknown — verify ...").',
  );
  return lines.join('\n');
}

function basenameNoExt(path: string): string {
  const slash = path.lastIndexOf('/');
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
}

/** Static specifiers from added diff lines: `from 'x'`, `import('x')`, `require('x')`, `import 'x'`. */
function extractStaticSpecifiers(patch: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\+\s*import\s+['"]([^'"]+)['"]/gm,
  ];
  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const body = line.slice(1);
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        const spec = m[1]?.trim();
        if (spec) out.push(spec);
      }
    }
  }
  return out;
}
