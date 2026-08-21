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
  { type: 'review', pattern: 'packages/review/**' },
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
  { from: 'di', allow: [...SHARED, 'di'] },
  { from: 'review', allow: [...SHARED, 'review'] },
  ...ENGINE_TYPES.map((type) => ({ from: type, allow: [...SHARED, type] })),
  { from: 'app', allow: [...SHARED, 'review', ...ENGINE_TYPES, 'app'] },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
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
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
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
