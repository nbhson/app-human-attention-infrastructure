import { defineConfig } from 'vitest/config';

/**
 * Review-slice coverage ratchet (R11).
 * Run with `pnpm test:coverage:review` — enforces 80/70 on the product's
 * critical path, while peripheral packages keep the 50/45 floor from
 * `vitest.config.ts`. CI `gate` runs this after `test:coverage` with Postgres.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'apps/api/src/routes/reviews.ts',
      'apps/api/src/services/review-ingest.ts',
      'apps/api/src/services/review-worker.ts',
      'packages/review/src/**/*.ts',
      'packages/writeback/src/**/*.ts',
      'packages/orchestrator/src/**/*.ts',
      'packages/db/src/schema/review-reports.ts',
      'packages/db/src/schema/review-decisions.ts',
      'packages/db/src/schema/enums.ts',
      'packages/agent-runtime/src/review/**/*.ts',
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/review-slice',
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/dist/**', '**/node_modules/**'],
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 80,
        statements: 80,
      },
      watermarks: { lines: [70, 85], branches: [65, 80] },
    },
  },
});
