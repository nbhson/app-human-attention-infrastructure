/**
 * Shared file classification for the review slice.
 *
 * Two orthogonal tests, kept in one module so the "generated" deny-list cannot
 * drift between the two places that care about it:
 *
 *  - {@link isGeneratedFile}: a generated/dependency artifact (lockfile, build
 *    output, source map, minified bundle) that is not hand-written and should
 *    never reach the reviewer's context.
 *  - {@link isSourceFile}: hand-written programming source — a recognised code
 *    extension that is *not* generated. This is what the "needs human attention"
 *    metric counts, so a 9k-line lockfile or a docs/config/infra file does not
 *    move the needle on how much *code* actually needs a human.
 */

/** Basenames that are machine-generated and never hand-written source. */
const GENERATED_FILENAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'Pipfile.lock',
  'go.sum',
  '.DS_Store',
  'Thumbs.db',
]);

/** Path patterns for generated/build/dependency output, not hand-written source. */
const GENERATED_PATH_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)out\//,
  /(^|\/)coverage\//,
  /(^|\/)\.next\//,
  /(^|\/)\.nuxt\//,
  /(^|\/)\.angular\//,
  /(^|\/)vendor\//,
  /(^|\/)target\//,
  /(^|\/)\.cache\//,
  /\.map$/,
  /\.min\.(js|mjs|css)$/,
];

/** Extensions we treat as programming/web source, not config/doc/data. */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.rb',
  '.php',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.swift',
  '.m',
  '.mm',
  '.sh',
  '.bash',
  '.sql',
  '.graphql',
  '.gql',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.vue',
  '.svelte',
]);

/** True when the path is a generated artifact/dependency, not hand-written source. */
export function isGeneratedFile(path: string): boolean {
  if (!path) {
    return false;
  }
  if (GENERATED_FILENAMES.has(path.split('/').pop() ?? '')) {
    return true;
  }
  return GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/** True for hand-written programming/web source (a code extension, not generated). */
export function isSourceFile(path: string): boolean {
  if (isGeneratedFile(path)) {
    return false;
  }
  const dot = path.lastIndexOf('.');
  if (dot === -1) {
    return false; // no extension → Dockerfile, Makefile, nginx.conf, …
  }
  return SOURCE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}
