import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * E2E runner config (day-37). Deliberately separate from the root
 * `vitest.config.ts` so `pnpm test` (unit) and `pnpm e2e` (full-system) stay
 * independent: the root config includes only source test files, and this config
 * includes only the e2e directory.
 *
 * These specs touch a real Postgres (via `@harness/db/test-utils` isolated
 * schemas), so the timeout is far more generous than a unit test's.
 *
 * The specs live at the repo root, outside any workspace package, so `@harness/*`
 * has no `node_modules` symlink to follow the way a spec inside `packages/*` does.
 * We map every `@harness` package straight to its built `dist` entry — the same
 * files the package `exports` map resolves to — plus the `/test-utils` subpath of
 * `@harness/db`, which points at its own `dist/test-utils.js`.
 */

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@harness/db/test-utils',
        replacement: join(ROOT, '../packages/db/dist/test-utils.js'),
      },
      {
        find: /^@harness\/([^/]+)$/,
        replacement: join(ROOT, '../packages/$1/dist/index.js'),
      },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['e2e/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // E2E files each allocate an isolated Postgres schema and own the full
    // object graph; serialising them avoids cross-file contention on the
    // shared postgres `vector` extension install and keeps logs readable.
    fileParallelism: false,
  },
});
