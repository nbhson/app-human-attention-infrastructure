import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';

import type { RuntimePollLoop } from '@harness/agent-runtime';
import type { DrizzleDB } from '@harness/db';
import { TOKENS } from '@harness/di';
import type { Logger } from '@harness/di';
import type { IEventBus } from '@harness/event-bus';
import type { DispatchLoop, TaskService } from '@harness/orchestrator';

import { buildApp } from './app.js';
import { bootContainer, buildContainer } from './bootstrap.js';
import { initApiTracing } from './observability.js';
import { reconcileOrphans } from './reconcile.js';

// Best-effort `.env` loading (mirrors packages/db/src/env.ts): `pnpm dev` runs
// with cwd `apps/api`, so `../../.env` points at the repo root where `.env`
// lives. Without this, `cp .env.example .env && pnpm dev` would fail fast in
// `buildContainer` with "DATABASE_URL is not set" — the db package only loads
// the file for its own migrate/seed scripts, not for the API entrypoint. An
// externally-exported DATABASE_URL still wins: dotenv never overrides.
for (const candidate of ['.env', '../../.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) {
    config({ path });
    break;
  }
}

// Build the object graph and resolve the core infrastructure eagerly so a
// missing DATABASE_URL or broken wiring fails fast at boot, not on first use.
const container = buildContainer();
// Bootstrap the OpenTelemetry provider FIRST (day-03 §3.2) so the very first
// `http.request` span — the earliest any code can touch — has a tracer ready.
initApiTracing(container);
const app = buildApp(container, { logger: true });
for (const token of Object.values(TOKENS)) {
  app.log.info(`di: registered token "${token}"`);
}
// Bind bus subscribers before recovery so the reconciler's events are persisted.
bootContainer(container);

// Start the pull-based dispatch loop (§2.5). The interval is configurable via
// env so it never needs to be hardcoded here.
const dispatchLoop = container.resolve<DispatchLoop>(TOKENS.DispatchLoop);
const runtimePollLoop = container.resolve<RuntimePollLoop>(TOKENS.RuntimePollLoop);

const start = async (): Promise<void> => {
  // Recover first (day-28 §6): a single-writer moment before any loop claims a
  // task, so an EXECUTING/VERIFYING row stranded by a previous SIGKILL is moved
  // to human attention before the dispatcher/runtime can touch it. Reordering
  // this would let a stale in-flight task be double-run.
  const recovered = await reconcileOrphans(
    container.resolve<DrizzleDB>(TOKENS.Db),
    container.resolve<TaskService>(TOKENS.TaskService),
    container.resolve<IEventBus>(TOKENS.EventBus),
    container.resolve<Logger>(TOKENS.Logger),
  );
  if (recovered > 0) {
    app.log.warn({ recovered }, 'recovered orphaned tasks at startup');
  }

  dispatchLoop.start(Number(process.env.DISPATCH_INTERVAL_MS ?? '2000'));
  runtimePollLoop.start(Number(process.env.RUNTIME_POLL_INTERVAL_MS ?? '2000'));

  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err as Error);
    process.exit(1);
  }
};

// Stop cleanly on shutdown: halt both poll loops, then drain any in-flight tick
// (day-26 §2.1 scenario 8) so a SIGTERM mid-execution leaves no orphaned task.
const shutdown = (): void => {
  dispatchLoop.stop();
  runtimePollLoop.stop();
  void Promise.all([dispatchLoop.waitForIdle(), runtimePollLoop.waitForIdle()]).then(() =>
    process.exit(0),
  );
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

void start();
