import Fastify from 'fastify';

import { TOKENS } from '@harness/di';

import { buildContainer } from './bootstrap.js';

const app = Fastify({ logger: true });

// Build the object graph and resolve the core infrastructure eagerly so a
// missing DATABASE_URL or broken wiring fails fast at boot, not on first use.
const container = buildContainer();
for (const token of Object.values(TOKENS)) {
  app.log.info(`di: registered token "${token}"`);
}
container.resolve(TOKENS.EventLogWriter);

app.get('/health', async () => ({ status: 'ok' }));

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err as Error);
    process.exit(1);
  }
};

void start();
