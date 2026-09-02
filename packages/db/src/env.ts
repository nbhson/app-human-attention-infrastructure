import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

// Best-effort `.env` loading: try the process cwd, then the monorepo root.
// Scripts run via `pnpm --filter @harness/db <script>` have cwd `packages/db`,
// so `../../.env` points at the repo root where `.env` lives.
for (const candidate of ['.env', '../../.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) {
    config({ path });
    break;
  }
}

/** Return a non-empty `DATABASE_URL`, or throw with a clear message. */
export function requireConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.length === 0) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env (repo root) or export DATABASE_URL.');
  }
  return url;
}
