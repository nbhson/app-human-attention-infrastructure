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
      // Global floor — deliberate 50/45/50/50 so local `pnpm test` without
      // DB still passes. The *real* bar lives in CI `gate` (Postgres-backed)
      // and as a review-policy ratchet (docs/runbook R11). Use
      // `pnpm test:coverage:review` for the enforced 80/70 slice gate.
      thresholds: {
        lines: 50,
        branches: 45,
        functions: 50,
        statements: 50,
      },
      // Chart coloring only (not a gate): lines below 60 read red in HTML.
      watermarks: {
        lines: [60, 80],
        branches: [50, 75],
      },
    },
  },
});
