/**
 * `code-index` indexer (day-14 §3.2) — a deterministic, hand-rolled TS/JS
 * symbol + dependency index, in place of tree-sitter.
 *
 * tree-sitter grammars are a native / `web-tree-sitter` dependency this repo does
 * not carry, and would risk CI fragility for a feature whose correctness
 * guarantee is the *fallback*, not the parse (§2.3). So the indexer extracts the
 * one signal the graph needs — module edges (`import` / `export … from` /
 * `import()` / `require()`) and, at a coarse level, the identifiers a module
 * imports and exports — with a conservative lexical scan:
 *
 *   - Every specifier it can prove is recorded as a local edge.
 *   - Any import it *cannot* map to a local file (a bare/aliased package, a
 *     dynamic `import(variable)` / `require(variable)`, or a code specifier with
 *     no local target) sets `complete: false` on the file, so `affectedTests`
 *     falls back to the full suite rather than guess.
 *
 * Over-approximation is safe: a spurious edge only runs a few extra tests. The
 * one sin is a *missed* edge, and `complete: false` is the guard against that.
 * This package is a pure leaf (node built-ins only, like `object-store`/`sandbox`).
 */

import { posix } from 'node:path';

/** A definition (an export) or a reference (an import) in a source file. */
export type SymbolKind = 'definition' | 'reference';

/** How two files are connected (day-14 §2.1). */
export type DependencyKind = 'static' | 'dynamic';

/** One lexical symbol with a 1-based line (the `symbols` table shape, §2.1). */
export interface IndexedSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly line: number;
}

/** A resolvable local dependency edge; the from-file is implicit in its owner. */
export interface IndexedEdge {
  readonly to: string;
  readonly kind: DependencyKind;
}

/** A source file's contribution to the dependency graph. */
export interface IndexedFile {
  readonly file: string;
  readonly symbols: readonly IndexedSymbol[];
  readonly edges: readonly IndexedEdge[];
  /**
   * False when this file holds an import the indexer could not resolve (dynamic
   * `import(variable)` / `require(variable)`, a bare package or path alias, or a
   * code specifier with no local target). A graph gap forces the full suite.
   */
  readonly complete: boolean;
}

/** Extensions a local import may resolve to (in the order we probe). */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** Non-code specifiers (assets/data) are ignored, not a gap and not an edge. */
const ASSET_EXTENSIONS = new Set([
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.html',
  '.md',
  '.mdx',
  '.txt',
  '.map',
  '.ico',
  '.woff',
  '.woff2',
  '.eot',
  '.ttf',
  '.gql',
  '.graphql',
]);

/** A bare specifier is one that is not `./`- or `../`-relative (a package/alias). */
function isBare(specifier: string): boolean {
  return !specifier.startsWith('./') && !specifier.startsWith('../');
}

const STATIC_FROM_RE = /\b(?:import|export)\b[\s\S]*?\bfrom\s*(['"])([^'"\n]+)\1/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s*(['"])([^'"\n]+)\1/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
// Every `import(` / `require(` call, literal or not. A call that is *not* one of
// the plain-literal specifiers captured above (e.g. `import(x)` or
// `import('./' + x)`) is a runtime-computed specifier we cannot resolve -> a
// graph gap detected by diffing these counts against the literal captures.
const IMPORT_CALL_RE = /\bimport\s*\(/g;
const REQUIRE_CALL_RE = /\brequire\s*\(/g;

// Symbol capture (best-effort lexical): imported references and exported
// definitions, sufficient to populate the `symbols` table.
const IMPORT_CLAUSE_RE = /\bimport\s+(?:type\s+)?([^;\n]+?)\s+from\s*['"][^'"\n]+['"]/g;
const EXPORT_DECL_RE =
  /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST_RE = /\bexport\s*\{([^}]*)\}/g;
const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/g;

/** Keywords that appear in an import/export clause but are not symbol names. */
const CLAUSE_KEYWORDS = new Set(['type', 'as', 'default', 'from', 'satisfies', 'assert', 'with']);

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10 /* \n */) {
      line += 1;
    }
  }
  return line;
}

/** Identifiers in an `import { a, b as c }` / re-export clause, de-aliased. */
function identifiersInClause(clause: string): string[] {
  const names: string[] = [];
  // Remove namespace aliases (`* as ns`) first, then gather every identifier and
  // drop the keywords.
  const withoutNamespace = clause.replace(/\*\s*as\s+[A-Za-z_$][\w$]*/g, ' ');
  for (const match of withoutNamespace.matchAll(IDENTIFIER_RE)) {
    const name = match[0];
    if (name !== undefined && !CLAUSE_KEYWORDS.has(name)) {
      names.push(name);
    }
  }
  return names;
}

interface RawSpecifier {
  readonly target: string;
  readonly kind: DependencyKind;
  readonly line: number;
}

/** Collect every literal module specifier, plus the symbols, for one file. */
function extractSource(source: string): {
  specifiers: RawSpecifier[];
  symbols: IndexedSymbol[];
  complete: boolean;
} {
  const specifiers: RawSpecifier[] = [];
  const symbols: IndexedSymbol[] = [];
  const seen = new Set<string>();

  const add = (target: string, kind: DependencyKind, index: number): void => {
    const line = lineOf(source, index);
    const key = `${kind}:${target}:${line}`;
    if (!seen.has(key)) {
      seen.add(key);
      specifiers.push({ target, kind, line });
    }
  };

  for (const match of source.matchAll(STATIC_FROM_RE)) {
    if (match.index !== undefined && match[2] !== undefined) add(match[2], 'static', match.index);
  }
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT_RE)) {
    if (match.index !== undefined && match[2] !== undefined) add(match[2], 'static', match.index);
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) {
    if (match.index !== undefined && match[2] !== undefined) add(match[2], 'dynamic', match.index);
  }
  for (const match of source.matchAll(REQUIRE_RE)) {
    if (match.index !== undefined && match[2] !== undefined) add(match[2], 'dynamic', match.index);
  }

  // A runtime-computed specifier anywhere in the file is a graph gap: any
  // `import(`/`require(` call beyond the plain-literal ones already captured.
  const literalDynamicCount = specifiers.filter((spec) => spec.kind === 'dynamic').length;
  const totalCallCount =
    [...source.matchAll(IMPORT_CALL_RE)].length + [...source.matchAll(REQUIRE_CALL_RE)].length;
  const hasDynamicVar = totalCallCount > literalDynamicCount;

  // References: identifiers imported (static imports only; dynamic specifiers
  // already mark the gap and import nothing we can name).
  for (const match of source.matchAll(IMPORT_CLAUSE_RE)) {
    const clause = match[1];
    if (clause === undefined || match.index === undefined) continue;
    for (const name of identifiersInClause(clause)) {
      symbols.push({ name, kind: 'reference', line: lineOf(source, match.index) });
    }
  }
  // Definitions: declared exports, listed re-exports, and the default export.
  for (const match of source.matchAll(EXPORT_DECL_RE)) {
    if (match.index !== undefined && match[1] !== undefined) {
      symbols.push({ name: match[1], kind: 'definition', line: lineOf(source, match.index) });
    }
  }
  for (const match of source.matchAll(EXPORT_LIST_RE)) {
    const clause = match[1];
    if (clause !== undefined && match.index !== undefined) {
      for (const name of identifiersInClause(clause)) {
        symbols.push({ name, kind: 'definition', line: lineOf(source, match.index) });
      }
    }
  }
  // `export default` with a named declaration/expression.
  const defaultRe =
    /\bexport\s+default\s+(?:(?:async\s+)?function\s+|class\s+)?([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(defaultRe)) {
    if (match.index !== undefined && match[1] !== undefined) {
      symbols.push({ name: match[1], kind: 'definition', line: lineOf(source, match.index) });
    }
  }

  return { specifiers, symbols, complete: !hasDynamicVar };
}

type ResolveResult =
  | { readonly status: 'local'; readonly target: string }
  | { readonly status: 'ignored' }
  | { readonly status: 'gap' };

/** Resolve a relative specifier against the known file set (conservative). */
function resolveSpecifier(
  knownFiles: ReadonlySet<string>,
  fromFile: string,
  specifier: string,
): ResolveResult {
  if (isBare(specifier)) {
    // A package name or path alias we cannot map locally — safe to treat as a
    // gap (run the full suite) rather than guess which files it reaches.
    return { status: 'gap' };
  }
  const ext = posix.extname(specifier);
  if (ASSET_EXTENSIONS.has(ext)) {
    return { status: 'ignored' };
  }
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  const candidates =
    ext === ''
      ? [
          base,
          ...CODE_EXTENSIONS.map((e) => base + e),
          ...CODE_EXTENSIONS.map((e) => posix.join(base, `index${e}`)),
        ]
      : [base];
  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) {
      return { status: 'local', target: candidate };
    }
  }
  return { status: 'gap' };
}

/** Index one source file's text into its symbols + resolved local edges. */
export function indexFile(
  file: string,
  source: string,
  knownFiles: ReadonlySet<string>,
): IndexedFile {
  const { specifiers, symbols, complete } = extractSource(source);
  const edges: IndexedEdge[] = [];
  let completeAfterResolve = complete;
  const seenEdges = new Set<string>();

  for (const spec of specifiers) {
    const resolved = resolveSpecifier(knownFiles, file, spec.target);
    if (resolved.status === 'local') {
      const key = `${resolved.target}:${spec.kind}`;
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        edges.push({ to: resolved.target, kind: spec.kind });
      }
    } else if (resolved.status === 'gap') {
      completeAfterResolve = false;
    }
    // 'ignored' (an asset) contributes neither an edge nor a gap.
  }

  return { file, symbols, edges, complete: completeAfterResolve };
}

/** Index every file at once (two passes so cross-file resolution is exact). */
export function indexFiles(files: ReadonlyMap<string, string>): Map<string, IndexedFile> {
  const knownFiles = new Set(files.keys());
  const indexed = new Map<string, IndexedFile>();
  for (const [file, source] of files) {
    indexed.set(file, indexFile(file, source, knownFiles));
  }
  return indexed;
}

/** Whether a path is a test file (drives affected-test collection, day-14 §2.2). */
export function isTestFile(file: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file) || file.includes('/__tests__/');
}
