/**
 * Idempotency under fault injection (Phase 3 day-36 §3.1).
 *
 * Day 08 shipped claim-then-write idempotency; this suite *attacks* it, not
 * trust it. The invariant under test is the one the acceptance criteria name in
 * the negative: **no duplicate external write** under concurrent retries, a
 * crash between claim and write, and a merely-reformatted retry.
 *
 * The {@link ConcurrencySafeStore} models the *fixed* `DrizzleWritebackLogStore`
 * (day-36 §2.1): `claim` is the atomic serialization point over the in-flight
 * partial unique index `(dedup_key) WHERE status IN ('PENDING','SUCCEEDED')` —
 * a second identical claim (same dedup key, still PENDING or already SUCCEEDED)
 * resolves to `duplicate` *before* any tool call, while a `FAILED` row leaves
 * the index so a retry after a real failure is still let through. The real
 * serialization point in production is the Postgres unique index (proven by
 * `packages/db/src/writeback-log-store.test.ts`); here we prove the *service*
 * honors the verdict the store returns.
 */

import { describe, expect, it } from 'vitest';

import { GitProviderType, WritebackAction } from '@harness/domain';
import type { WriteBackIntent, WritebackClaim, WritebackFinalize, WritebackLogStore } from '@harness/domain';
import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';
import { StaticGitToolMap } from '@harness/git-provider';
import { StaticTicketToolMap } from '@harness/ticket-provider';

import { MCPWriteBack } from '../mcp-writeback.js';
import { dedupKey } from '../dedup.js';

// --- Fakes ----------------------------------------------------------------

/** A client that records every `callTool` and returns a fixed success result. */
class FakeMcpClient implements McpClient {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(protected readonly result: ToolResult = { isError: false, content: [] }) {}

  initialize() {
    return Promise.resolve({ name: 'fake', version: '0.0.0' });
  }
  listTools() {
    return Promise.resolve([]);
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    return this.result;
  }
  close() {
    return Promise.resolve();
  }
}

/** A client that throws on the first `k` calls, then succeeds — the crash seam. */
class FlakyMcpClient extends FakeMcpClient {
  private failuresLeft: number;

  constructor(
    private readonly error: Error,
    failures: number,
  ) {
    super({ isError: false, content: [] });
    this.failuresLeft = failures;
  }

  override async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw this.error;
    }
    return this.result;
  }
}

/**
 * An in-memory store faithfully modelling the *fixed* Drizzle claim semantics:
 * `claim` rejects a second identical key that is still `PENDING`/`SUCCEEDED`
 * (the in-flight partial unique index), but lets a `FAILED` key be retried.
 * The check-and-insert runs without an `await` gap, so concurrent `write()`
 * calls serialize exactly as the Postgres unique index does.
 */
class ConcurrencySafeStore implements WritebackLogStore {
  readonly rows: Array<{
    intentId: string;
    dedupKey: string;
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'DUPLICATE';
    error?: string;
  }> = [];

  async claim(input: WritebackClaim): Promise<'claimed' | 'duplicate'> {
    const inflight = this.rows.some(
      (row) => row.dedupKey === input.dedupKey && (row.status === 'PENDING' || row.status === 'SUCCEEDED'),
    );
    this.rows.push({
      intentId: input.intentId,
      dedupKey: input.dedupKey,
      status: inflight ? 'DUPLICATE' : 'PENDING',
    });
    return inflight ? 'duplicate' : 'claimed';
  }

  async finalize(input: WritebackFinalize): Promise<void> {
    const row = this.rows.find((r) => r.intentId === input.intentId);
    if (row) {
      row.status = input.status;
      if (input.error !== undefined) {
        row.error = input.error;
      }
    }
  }
}

function fakeRegistry(client: McpClient): McpServerRegistry {
  return {
    get: async () => client,
    entries: () => [],
    list: () => [],
    closeAll: async () => {},
  };
}

function commentIntent(id: string, body: string): WriteBackIntent {
  return {
    id,
    provider: GitProviderType.GitHub,
    externalId: '42',
    repo: 'github.com/acme/api',
    action: WritebackAction.Comment,
    body,
  };
}

function build(client: McpClient, store: WritebackLogStore) {
  const service = new MCPWriteBack(fakeRegistry(client), new StaticGitToolMap(), new StaticTicketToolMap(), store, {
    enabled: () => true,
  });
  return { service, client, store };
}

// --- The attacks ----------------------------------------------------------

describe('idempotency under fault injection (day-36)', () => {
  it('concurrent identical intents produce exactly one external comment', async () => {
    const client = new FakeMcpClient();
    const store = new ConcurrencySafeStore();
    const { service } = build(client, store);

    // Three racing identical writes, differing only in their (fresh) intent ids.
    const intents = ['wb-1', 'wb-2', 'wb-3'].map((id) => commentIntent(id, 'LGTM'));
    const results = await Promise.all(intents.map((intent) => service.write(intent)));

    results.forEach((result, i) => {
      expect(result).toEqual({ ok: true, intentId: intents[i]!.id });
    });
    // The invariant: at most one external write.
    expect(client.calls).toHaveLength(1);
    expect(store.rows.map((r) => r.status)).toEqual(['SUCCEEDED', 'DUPLICATE', 'DUPLICATE']);
  });

  it('a claim that crashes before finalize blocks the retry, not re-writes', async () => {
    const client = new FakeMcpClient();
    const store = new ConcurrencySafeStore();
    const { service } = build(client, store);

    // Simulate a crash between claim and finalize: a PENDING row exists that
    // never reached a terminal state (the process died after the external write).
    const crashedIntent = commentIntent('wb-crashed', 'approved');
    await store.claim({
      intentId: 'wb-crashed',
      provider: crashedIntent.provider,
      externalId: crashedIntent.externalId,
      action: crashedIntent.action,
      body: 'approved',
      dedupKey: dedupKey(crashedIntent),
    });

    // A retry of the identical intent must resolve to a no-op, not a second write.
    const retry = await service.write(commentIntent('wb-retry', 'approved'));

    expect(retry).toEqual({ ok: true, intentId: 'wb-retry' });
    expect(client.calls).toHaveLength(0);
    expect(store.rows.map((r) => r.status)).toEqual(['PENDING', 'DUPLICATE']);
  });

  it('a genuinely FAILED attempt is retryable (FAILED leaves the in-flight index)', async () => {
    // Fails once, then succeeds: the first write records FAILED and the retry
    // is allowed to reach the host again — the very path that must NOT be
    // mistaken for a duplicate.
    const client = new FlakyMcpClient(new Error('host unreachable'), 1);
    const store = new ConcurrencySafeStore();
    const { service } = build(client, store);

    const first = await service.write(commentIntent('wb-1', 'approved'));
    expect(first.ok).toBe(false);

    const retry = await service.write(commentIntent('wb-2', 'approved'));

    expect(retry).toEqual({ ok: true, intentId: 'wb-2' });
    expect(client.calls).toHaveLength(2);
    expect(store.rows.map((r) => r.status)).toEqual(['FAILED', 'SUCCEEDED']);
  });

  it('a reformatted retry (whitespace) collapses to the same dedup key — one write', async () => {
    const client = new FakeMcpClient();
    const store = new ConcurrencySafeStore();
    const { service } = build(client, store);

    const first = await service.write(commentIntent('wb-1', '  LGTM\n\n — please merge\t'));
    const reformatted = await service.write(commentIntent('wb-2', 'LGTM — please merge'));

    expect(first).toEqual({ ok: true, intentId: 'wb-1' });
    expect(reformatted).toEqual({ ok: true, intentId: 'wb-2' });
    expect(client.calls).toHaveLength(1);
    expect(store.rows.map((r) => r.status)).toEqual(['SUCCEEDED', 'DUPLICATE']);
  });

  it('two *different* bodies do not dedup — each writes once', async () => {
    const client = new FakeMcpClient();
    const store = new ConcurrencySafeStore();
    const { service } = build(client, store);

    await service.write(commentIntent('wb-1', 'LGTM'));
    await service.write(commentIntent('wb-2', 'needs work'));

    expect(client.calls).toHaveLength(2);
    expect(store.rows.map((r) => r.status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
  });
});
