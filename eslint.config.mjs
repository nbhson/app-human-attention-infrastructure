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
  { type: 'sandbox', pattern: 'packages/sandbox/**' },
  { type: 'git-provider', pattern: 'packages/git-provider/**' },
  { type: 'ticket-provider', pattern: 'packages/ticket-provider/**' },
  { type: 'code-index', pattern: 'packages/code-index/**' },
  { type: 'writeback', pattern: 'packages/writeback/**' },
  { type: 'mcp', pattern: 'packages/mcp/**' },
  { type: 'review', pattern: 'packages/review/**' },
  { type: 'memory', pattern: 'packages/memory/**' },
  { type: 'judge', pattern: 'packages/judge/**' },
  { type: 'benchmark', pattern: 'packages/benchmark/**' },
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
  {
    from: 'sandbox',
    // The isolated-execution seam is a leaf like object-store: no @harness
    // runtime dependency (only node built-ins). Everything may import the
    // `Sandbox` interface and its Docker runtime.
    allow: ['sandbox'],
  },
  {
    from: 'mcp',
    // The generic MCP client is a protocol leaf: it reads domain types only
    // (and nothing else in @harness — transport is node built-ins). Anything may
    // import it, like object-store/sandbox.
    allow: ['domain', 'mcp'],
  },
  {
    from: 'git-provider',
    // The Git-host read seam reads only domain types (the `PullRequest` value
    // object + provider slug) and the protocol leaf (`@harness/mcp`) for the
    // MCP-backed provider (Phase 3). No db, no event-bus, no sibling engine.
    allow: ['domain', 'mcp', 'git-provider'],
  },
  {
    from: 'ticket-provider',
    // The ticket-system read seam reads only domain types (the `Issue` value
    // object + provider slug) and the protocol leaf (`@harness/mcp`) for the
    // MCP-backed provider (Phase 3). No db, no event-bus, no sibling engine.
    allow: ['domain', 'mcp', 'ticket-provider'],
  },
  {
    from: 'code-index',
    // The dependency-graph leaf (day-14 §2.4): builds a symbol import/index and
    // computes affected tests from file bytes. It may read domain/db/di types
    // for a persistence layer, but today the graph is pure (node built-ins only),
    // like object-store/sandbox. Consumed by the app host, never imported by a
    // sibling engine — verification-engine reaches it through the resolver seam.
    allow: ['domain', 'db', 'di', 'code-index'],
  },
  {
    from: 'writeback',
    // The write-back seam reads the intent/result contract (domain), the
    // protocol leaf (mcp), and the two provider seams' capability→tool-name
    // tables (git-provider + ticket-provider) — never a db, event-bus, engine,
    // or host REST adapter.
    allow: ['domain', 'mcp', 'git-provider', 'ticket-provider', 'writeback'],
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
  {
    from: 'memory',
    // Review memory (day-16 §2.4): reads domain types, persists via db, emits on
    // the event-bus, and accepts the structural logger (di) — never a sibling
    // engine. Context/Attention reach it via the event bus, not an import.
    allow: [...SHARED, 'memory'],
  },
  {
    from: 'judge',
    // Review-quality judge (day-21 §2.4): reads domain types (including the
    // `LLMProvider` + `JudgeRunStore` seams) and accepts the structural logger
    // (di). It orders no db write or event-bus publish of its own — the app host
    // binds both seams — so it is a leaf with no shared-package write side, and
    // it never imports a sibling engine (its LLM is the domain seam, not
    // `agent-runtime`).
    allow: ['domain', 'di', 'judge'],
  },
  {
    from: 'benchmark',
    // The read-only evaluator (day-24 §2.3): reads domain value types, persists
    // via db (the review_examples table), and runs the judge through its seam.
    // Never a sibling engine (attention/context) or the review package.
    allow: ['domain', 'db', 'judge', 'benchmark'],
  },
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
    allow: [...SHARED, 'observability', 'embeddings', 'object-store', 'sandbox', type],
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
      'sandbox',
      'mcp',
      'git-provider',
      'ticket-provider',
      'code-index',
      'writeback',
      'memory',
      'judge',
      'benchmark',
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
      'packages/mcp/src/__tests__/fixtures/**',
      'packages/mcp/src/__tests__/stub-servers/**',
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
        // The Day-25 E2E driver and the Day-37 E2E specs live outside `src/`
        // (and outside the api tsconfig); lint them under a default project so
        // type-aware rules still apply.
        projectService: {
          allowDefaultProject: ['apps/api/scripts/*.ts', 'e2e/*.ts'],
          // The api scripts + e2e specs live outside `src/` and outside the api
          // tsconfig, so tseslint lints them under the default project. That path
          // caps its file count at 8 to avoid a slow fallback project; we have 9
          // scripts (day-25 added calibration-report.ts) + 2 e2e specs (day-37),
          // so raise the cap rather than give them a shared throwaway project.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
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
      'packages/evaluation/src/ab/ab-report.ts',
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
