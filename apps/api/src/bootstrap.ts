/**
 * The single place the object graph is wired.
 *
 * Dependencies are registered in strict topological order (day-05 §2.3): the
 * event bus first, then the database, then the writer that forwards bus events
 * into `event_log`, and finally the engine slots. Engines receive `IEventBus`
 * (never `InProcessEventBus`) so they stay swappable.
 *
 * Rule (day-05 §6): `new InProcessEventBus()` may appear *only* here. Anywhere
 * else that needs the bus must `resolve(TOKENS.EventBus)`.
 */

import { Container, TOKENS } from '@harness/di';
import { EventLogWriter, createDb } from '@harness/db';
import { InProcessEventBus } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';

/** Engine tokens registered as stubs until their build day (Days 06+). */
const ENGINE_STUB_TOKENS = [
  TOKENS.Orchestrator,
  TOKENS.AgentRuntime,
  TOKENS.ContextEngine,
  TOKENS.ArtifactTracker,
  TOKENS.AttentionEngine,
  TOKENS.VerificationEngine,
] as const;

/**
 * Return a stand-in for an engine that has not been built yet. The stand-in is
 * constructible (so the graph resolves), but any interaction throws a clear
 * "not yet implemented" instead of silently doing nothing.
 */
function notYetImplemented(token: string): object {
  return new Proxy(
    {},
    {
      get(_target, property) {
        // A thenable proxy would be mistaken for a Promise by `await`.
        if (property === 'then') {
          return undefined;
        }
        throw new Error(`[di] "${token}" is not yet implemented`);
      },
    },
  );
}

/** Build the full container, wiring every token in dependency order. */
export function buildContainer(): Container {
  const c = new Container();

  c.register(TOKENS.EventBus, () => new InProcessEventBus());

  c.register(TOKENS.Db, () => {
    const url = process.env.DATABASE_URL;
    if (!url || url.length === 0) {
      throw new Error(
        'DATABASE_URL is not set. Copy .env.example to .env (repo root) or export DATABASE_URL.',
      );
    }
    return createDb(url);
  });

  c.register(TOKENS.EventLogWriter, (container) => {
    const writer = new EventLogWriter(container.resolve(TOKENS.Db));
    writer.subscribeTo(container.resolve<IEventBus>(TOKENS.EventBus));
    return writer;
  });

  // Engines are wired on their own build days; until then each token resolves
  // to a stub so the architecture test can build the graph end-to-end.
  for (const token of ENGINE_STUB_TOKENS) {
    c.register(token, () => notYetImplemented(token));
  }

  return c;
}
