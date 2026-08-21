import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // RTL's auto-cleanup registers against the global `afterEach`; enable
    // globals so jsdom component tests reset the DOM between cases.
    globals: true,
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/src/**/*.test.tsx'],
  },
});
