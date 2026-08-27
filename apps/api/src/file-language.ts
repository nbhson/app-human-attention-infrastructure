/**
 * Language of a changed file, named the way GitHub's linguist names it, for the
 * review dashboard's "Languages" bar. Pure and total: every path resolves to a
 * string — an unknown or unclassifiable path falls back to `'Other'`, mirroring
 * GitHub's own collapse of the long tail. Weights/percentages are *not* decided
 * here; callers count lines per language and divide by the reviewable diff.
 *
 * This is a language heuristic over the file *path*, not a byte-level linguist
 * scan: it can only be as good as the extension. That is the honest ceiling on
 * what the stored PR payload (`files[].path`) supports.
 */

/** Extension (lower-cased, leading dot) → GitHub language name. */
const BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.scala': 'Scala',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.m': 'Objective-C',
  '.mm': 'Objective-C',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.sql': 'SQL',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'SCSS',
  '.less': 'Less',
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
};

/** Whole-basename languages that carry no extension of their own. */
const BY_FILENAME: Record<string, string> = {
  Dockerfile: 'Dockerfile',
  Makefile: 'Makefile',
};

/** Language of a single changed-file path; `'Other'` when it is not recognised. */
export function languageOfFile(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot !== -1) {
    const byExtension = BY_EXTENSION[base.slice(dot).toLowerCase()];
    if (byExtension !== undefined) {
      return byExtension;
    }
  }
  return BY_FILENAME[base] ?? 'Other';
}
