import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';

import { TOKENS } from '@harness/di';
import { brand, EventType } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { ensureImage } from '@harness/sandbox';

import { buildApp } from './app.js';
import { bootContainer, buildContainer } from './bootstrap.js';
import { initApiTracing } from './observability.js';

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
// Bind bus subscribers so their side effects are live before serving requests.
bootContainer(container);

// Emit the runtime lifecycle event (day-34 §4.5) *after* the subscribers are
// bound so the EventLogWriter picks it up — "application started" shows up as the
// first entry on the audit timeline, carrying the components that were wired.
const bus = container.resolve<IEventBus>(TOKENS.EventBus);
bus.publish(
  createEvent(EventType.SystemStarted, brand('bootstrap', 'CorrelationID'), {
    service: 'harness-api',
    transport: process.env.EVENT_TRANSPORT ?? 'inproc',
    components: Object.values(TOKENS),
  }),
);

const start = async (): Promise<void> => {
  try {
    // Make sure the verification sandbox image exists before serving, so a fresh
    // checkout doesn't silently drop every review verification into SKIPPED
    // ("sandbox unavailable", Docker exit 125). `ensureImage` inspects first (a
    // sub-second no-op when already built) and only `docker build`s when missing.
    // Kept non-fatal: a down daemon or a failed build logs a warning and the
    // server still boots — verification then reports SKIPPED as before.
    await ensureImage(process.env.VERIFY_SANDBOX_IMAGE ?? 'harness-verify:node20').catch(
      (error: unknown) => {
        app.log.warn(`sandbox verification image not ensured: ${String(error)}`);
      },
    );
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err as Error);
    process.exit(1);
  }
};

// A graceful stop waits for in-flight requests to finish before exiting, so the
// audit log captures the `system.stopped` event with an accurate duration and
// downstream load-balancers stop routing to us before we tear down.
async function gracefulShutdown(signal: string): Promise<void> {
  const bus = container.resolve<IEventBus>(TOKENS.EventBus);
  bus.publish(
    createEvent(EventType.SystemStopped, brand('bootstrap', 'CorrelationID'), {
      service: 'harness-api',
      reason: signal,
    }),
  );
  await app.close().catch((err: unknown) => {
    app.log.warn(`graceful shutdown close failed: ${String(err)}`);
  });
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void gracefulShutdown(signal);
  });
}

void start();
