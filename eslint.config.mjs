import boundaries from 'eslint-plugin-boundaries';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Architectural boundary types (Spec 1 §5).
 *
 * Each engine gets its *own* element type rather than a single shared `engine`
 * type, so `boundaries/element-types` can express "an engine may import shared
 * packages and its own files, but never a sibling engine" (rule R4) directly.
 * A single `engine` type cannot forbid Orchestrator → VerificationEngine while
 * still allowing Orchestrator → Orchestrator.
 */
const ENGINE_TYPES = [
  'orchestrator',
  'agent-runtime',
  'context-engine',
  'artifact-tracker',
  'attention-engine',
  'verification-engine',
];

/** Packages every non-domain package may depend on (inward-only). */
const SHARED = ['domain', 'event-bus', 'db', 'di'];

const elements = [
  { type: 'domain', pattern: 'packages/domain/**' },
  { type: 'event-bus', pattern: 'packages/event-bus/**' },
  { type: 'db', pattern: 'packages/db/**' },
  { type: 'di', pattern: 'packages/di/**' },
  { type: 'embeddings', pattern: 'packages/embeddings/**' },
  { type: 'object-store', pattern: 'packages/object-store/**' },
  { type: 'review', pattern: 'packages/review/**' },
  { type: 'auth', pattern: 'packages/auth/**' },
  { type: 'observability', pattern: 'packages/observability/**' },
  { type: 'evaluation', pattern: 'packages/evaluation/**' },
  ...ENGINE_TYPES.map((type) => ({ type, pattern: `packages/${type}/**` })),
  { type: 'app', pattern: 'apps/**' },
];

/**
 * element-types rules, one `from` entry per element type. `default: 'disallow'`
 * means every import not explicitly allowed is a lint error. Each type allows
 * itself so intra-package relative imports stay legal.
 */
const elementTypesRules = [
  { from: 'domain', allow: ['domain'] },
  { from: 'event-bus', allow: ['domain', 'event-bus'] },
  { from: 'db', allow: ['domain', 'event-bus', 'db'] },
  {
    from: 'object-store',
    // A pure content-addressed byte store: depends on no @harness package (the
    // S3 SDK is external, not a boundary element). Everything may import it.
    allow: ['object-store'],
  },
  { from: 'di', allow: [...SHARED, 'di'] },
  {
    from: 'embeddings',
    // R10 (day-16 §2.4, widened day-17): the provider seam itself reads only
    // domain types, but the Day-17 index-population job that lands in this
    // package must persist vectors (`db`) and subscribe to artifact events
    // (`event-bus`). Still never a sibling engine.
    allow: ['domain', 'db', 'event-bus', 'embeddings'],
  },
  { from: 'review', allow: [...SHARED, 'observability', 'review'] },
  { from: 'auth', allow: [...SHARED, 'auth'] },
  {
    from: 'observability',
    // Same depth as shared infra: reads types/ids from domain, and the
    // trace write-through needs the db schema for the mapping row.
    allow: [...SHARED, 'observability'],
  },
  {
    from: 'evaluation',
    // Offline pipeline scoring: reads types (domain) and the append-only store
    // (db), uses the structured logger (di), and pushes gauges (observability).
    // Never an engine.
    allow: [...SHARED, 'observability', 'evaluation'],
  },
  ...ENGINE_TYPES.map((type) => ({
    from: type,
    allow: [...SHARED, 'observability', 'embeddings', 'object-store', type],
  })),
  {
    from: 'app',
    allow: [
      ...SHARED,
      'auth',
      'review',
      'observability',
      'evaluation',
      'embeddings',
      'object-store',
      ...ENGINE_TYPES,
      'app',
    ],
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      'sandbox/**',
      'working-repo/**',
      '**/*.config.ts',
      '**/*.config.mjs',
      'eslint.config.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // Day-25 E2E driver lives outside `src/` (and outside the api tsconfig);
        // lint it under a default project so type-aware rules still apply.
        projectService: {
          allowDefaultProject: ['apps/api/scripts/*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': 'error',
    },
  },
  {
    // CLI entrypoints and test fixtures are the only places a bare `console` is
    // legitimate (day-27 §2.1): migration/seed drivers print once to a terminal,
    // the E2E scripts are run directly, and tests may emit diagnostic lines. All
    // runtime code must log through the structured `Logger` instead.
    files: [
      'apps/api/scripts/**',
      'packages/db/src/migrate.ts',
      'packages/db/src/seed.ts',
      'packages/db/src/audit-orphans.ts',
      'packages/evaluation/src/cli.ts',
      'packages/evaluation/src/report-cli.ts',
      'packages/evaluation/src/replay-cli.ts',
      'packages/evaluation/src/ab-cli.ts',
      'packages/evaluation/src/make-dataset-cli.ts',
      'packages/evaluation/src/fit-cli.ts',
      'packages/embeddings/src/cli.ts',
      '**/*.test.ts',
      '**/__tests__/**',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
      'boundaries/elements': elements,
      // pnpm symlinks workspace packages into each consumer's node_modules, so
      // Node's default resolution returns `node_modules/@harness/*` (classified
      // "external"). The TypeScript resolver follows those symlinks back to the
      // real `packages/*` source, so boundary rules can see the true element.
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['packages/*/tsconfig.json', 'apps/*/tsconfig.json'],
        },
      },
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: elementTypesRules,
        },
      ],
    },
  },
);
