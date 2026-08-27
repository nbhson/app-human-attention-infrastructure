import { EventType } from '@harness/domain';
import { TOKENS } from '@harness/di';
import { EventLogWriter } from '@harness/db';
import { InProcessEventBus } from '@harness/event-bus';

import { afterEach, describe, expect, it } from 'vitest';

import { buildContainer } from './bootstrap.js';

const DATABASE_URL = 'postgres://harness:harness@localhost:5432/harness';

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.MCP_CONFIG_PATH;
});

describe('buildContainer', () => {
  it('resolves the full graph in dependency order without throwing', () => {
    process.env.DATABASE_URL = DATABASE_URL;
    // The full graph includes the OIDC provider seam, which fails fast when
    // neither mock nor a real IdP is configured (mock OIDC is deliberately
    // opt-in — it trusts any code). Day-01 auth added it to the graph.
    process.env.OIDC_MOCK = 'true';
    // The MCP registry loads `mcp.config.json` (git-ignored, environment-
    // specific). A developer's local copy can declare servers whose `tokenEnv`
    // isn't set (GITHUB_TOKEN, …), which makes the registry throw at resolve
    // time. Point it at a missing path so this graph-completeness test resolves
    // a deterministic, empty registry in every environment.
    process.env.MCP_CONFIG_PATH = '/nonexistent/mcp.config.json';
    const container = buildContainer();

    // Resolving every token proves the graph is complete. postgres.js opens no
    // connection until the first query, so this is side-effect-free.
    for (const token of Object.values(TOKENS)) {
      expect(() => container.resolve(token)).not.toThrow();
    }
  });

  it('wires the EventBus to the concrete InProcessEventBus', () => {
    process.env.DATABASE_URL = DATABASE_URL;
    const container = buildContainer();

    expect(container.resolve(TOKENS.EventBus)).toBeInstanceOf(InProcessEventBus);
  });

  it('wires the EventLogWriter and subscribes it to every event type on the bus', () => {
    process.env.DATABASE_URL = DATABASE_URL;
    const container = buildContainer();

    const writer = container.resolve(TOKENS.EventLogWriter);
    const bus = container.resolve<InProcessEventBus>(TOKENS.EventBus);

    expect(writer).toBeInstanceOf(EventLogWriter);
    // `EventLogWriter.subscribeTo` subscribes to every known event type.
    for (const eventType of Object.values(EventType)) {
      expect(bus.subscriberCount(eventType)).toBeGreaterThan(0);
    }
  });

  it('returns the same instance for repeated resolutions', () => {
    process.env.DATABASE_URL = DATABASE_URL;
    const container = buildContainer();

    expect(container.resolve(TOKENS.EventBus)).toBe(container.resolve(TOKENS.EventBus));
    expect(container.resolve(TOKENS.Db)).toBe(container.resolve(TOKENS.Db));
  });

  it('registers engine stubs that throw "not yet implemented" on use', () => {
    process.env.DATABASE_URL = DATABASE_URL;
    const container = buildContainer();

    const orchestrator = container.resolve<{ start: () => void }>(TOKENS.Orchestrator);

    expect(() => orchestrator.start()).toThrow(/not yet implemented/i);
  });

  it('fails fast with a clear message when DATABASE_URL is missing', () => {
    const container = buildContainer();

    expect(() => container.resolve(TOKENS.Db)).toThrow(/DATABASE_URL is not set/);
  });
});
