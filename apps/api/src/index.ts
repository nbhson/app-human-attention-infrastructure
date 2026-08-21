import Fastify from 'fastify';

import type { RuntimePollLoop } from '@harness/agent-runtime';
import { TOKENS } from '@harness/di';
import type { DispatchLoop } from '@harness/orchestrator';

import { buildContainer } from './bootstrap.js';

const app = Fastify({ logger: true });

// Build the object graph and resolve the core infrastructure eagerly so a
// missing DATABASE_URL or broken wiring fails fast at boot, not on first use.
const container = buildContainer();
for (const token of Object.values(TOKENS)) {
  app.log.info(`di: registered token "${token}"`);
}
container.resolve(TOKENS.EventLogWriter);
container.resolve(TOKENS.ArtifactCaptureSubscriber);

// Start the pull-based dispatch loop (§2.5). The interval is configurable via
// env so it never needs to be hardcoded here.
const dispatchLoop = container.resolve<DispatchLoop>(TOKENS.DispatchLoop);
dispatchLoop.start(Number(process.env.DISPATCH_INTERVAL_MS ?? '2000'));

// Day 12: the runtime poll loop executes QUEUED tasks alongside dispatch.
const runtimePollLoop = container.resolve<RuntimePollLoop>(TOKENS.RuntimePollLoop);
runtimePollLoop.start(Number(process.env.RUNTIME_POLL_INTERVAL_MS ?? '2000'));

app.get('/health', async () => ({ status: 'ok' }));

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err as Error);
    process.exit(1);
  }
};

// Stop cleanly on shutdown: halt both poll loops, then let the process exit.
const shutdown = (): void => {
  dispatchLoop.stop();
  runtimePollLoop.stop();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

void start();
