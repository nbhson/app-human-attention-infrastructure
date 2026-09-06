import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // RTL's auto-cleanup registers against the global `afterEach`; enable
    // globals so jsdom component tests reset the DOM between cases.
    globals: true,
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      // Exclude test files, fixtures, generated output, and e2e harness
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/__tests__/**',
        '**/dist/**',
        '**/coverage/**',
        '**/node_modules/**',
        'e2e/**',
        'fixtures/**',
        'sandbox/**',
        'apps/web/**',
        '**/test-utils.ts',
        '**/fixtures/**',
        '**/*.config.*',
      ],
      // Global gate — requires Postgres (CI `unit`/`gate` provide it).
      // Local `pnpm test` without DB will show lower coverage; use
      // `pnpm test:coverage` with `docker compose up -d` for the real number.
      thresholds: {
        lines: 50,
        branches: 45,
        functions: 50,
        statements: 50,
      },
      // Per-critical-package floors — the review slice must stay well-tested
      watermarks: {
        lines: [60, 80],
        branches: [50, 75],
      },
    },
  },
});
