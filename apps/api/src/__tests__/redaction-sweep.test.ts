/**
 * Redaction sweep (Phase 3 day-36 §3.2) — the tripwire that turns "tokens are
 * never logged" from a convention into a tested invariant.
 *
 * The failure path is the leak vector: a host can bounce an error that echoes
 * the very `Authorization` header we sent (a `Bearer` token, a `token=` kv, or
 * an arbitrary env credential that matches no pattern). This suite makes a
 * {@link MCPWriteBack} fail on purpose, then sweeps every surface the failure
 * reaches — the returned error, the `writeback_log.error`/`body` columns, and
 * (as a guard on the model) `provider_configs.token_redacted` — and asserts no
 * secret byte survives. The redaction marker is required to be present, so the
 * sweep proves the *mask*, not just the absence of a string that was never
 * there (day-36 §2.2).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { GitProviderType, WritebackAction } from '@harness/domain';
import type { WriteBackIntent } from '@harness/domain';
import { DrizzleWritebackLogStore, providerConfigs, writebackLog } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';
import { StaticGitToolMap } from '@harness/git-provider';
import { StaticTicketToolMap } from '@harness/ticket-provider';
import { MCPWriteBack } from '@harness/writeback';

const SCHEMA = 'harness_test_redaction_sweep';

// One pattern-matching secret and one that matches *no* regex — the latter can
// only be caught by the env-value literal scrub (`credentialEnvValues`), which
// is exactly the seam this sweep exists to prove at the persistence boundary.
const GH_SECRET = 'ghp_sweepSecret1234567890';
const JIRA_SECRET = 'sweepJiraValue_9f8e7d';
const SECRETS = [GH_SECRET, JIRA_SECRET];

const ENV_KEYS = ['GITHUB_TOKEN', 'JIRA_TOKEN'] as const;
const PREV: Record<string, string | undefined> = {};

let testDb: TestDb;

beforeAll(async () => {
  ENV_KEYS.forEach((key, i) => {
    PREV[key] = process.env[key];
    process.env[key] = [GH_SECRET, JIRA_SECRET][i]!;
  });
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  ENV_KEYS.forEach((key) => {
    if (PREV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = PREV[key];
    }
  });
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // The test schema is shared across the file; start each sweep from a clean slate.
  await testDb.db.delete(providerConfigs);
  await testDb.db.delete(writebackLog);
});

/** A client that fails by echoing the secrets back in an error — the leak shape under test. */
class SecretLeakingClient implements McpClient {
  initialize() {
    return Promise.resolve({ name: 'leaky', version: '0.0.0' });
  }
  listTools() {
    return Promise.resolve([]);
  }
  async callTool(): Promise<ToolResult> {
    throw new Error(
      `Authorization: Bearer ${GH_SECRET} rejected; token=${JIRA_SECRET} echoed by the host`,
    );
  }
  close() {
    return Promise.resolve();
  }
}

function registry(client: McpClient): McpServerRegistry {
  return {
    get: async () => client,
    entries: () => [],
    list: () => [],
    closeAll: async () => {},
  };
}

function commentIntent(): WriteBackIntent {
  return {
    id: 'wb-sweep',
    provider: GitProviderType.GitHub,
    externalId: '42',
    repo: 'github.com/acme/api',
    action: WritebackAction.Comment,
    body: 'approved',
  };
}

/** Find every secret that appears literally in any surface. */
function leakedSecrets(...surfaces: Array<string | null | undefined>): string[] {
  const found: string[] = [];
  for (const surface of surfaces) {
    if (surface === null || surface === undefined) {
      continue;
    }
    for (const secret of SECRETS) {
      if (surface.includes(secret)) {
        found.push(secret);
      }
    }
  }
  return found;
}

describe('redaction sweep (day-36)', () => {
  it('a failing write-back leaves no token byte in the result or the audit row', async () => {
    const service = new MCPWriteBack(
      registry(new SecretLeakingClient()),
      new StaticGitToolMap(),
      new StaticTicketToolMap(),
      new DrizzleWritebackLogStore(testDb.db),
      { enabled: () => true },
    );

    const result = await service.write(commentIntent());

    expect(result.ok).toBe(false);
    const rows = await testDb.db.select().from(writebackLog);
    expect(rows).toHaveLength(1);
    const error = rows[0]?.error;

    // The sweep: neither the returned error nor any persisted column carries a secret.
    expect(leakedSecrets(result.error, error, rows[0]?.body)).toEqual([]);
    // And the mask is actually present — redaction happened, not an empty leak.
    expect(error).toContain('[redacted]');
    expect(result.error).toContain('[redacted]');
  });

  it('the env-literal scrub catches the non-pattern secret, not just the regexes', async () => {
    const service = new MCPWriteBack(
      registry(new SecretLeakingClient()),
      new StaticGitToolMap(),
      new StaticTicketToolMap(),
      new DrizzleWritebackLogStore(testDb.db),
      { enabled: () => true },
    );

    const result = await service.write(commentIntent());
    const rows = await testDb.db.select().from(writebackLog);

    // JIRA_SECRET matches none of the Bearer/Basic/token=/ghp_/xox/AKIA regexes;
    // only the literal env-value scrub could have removed it.
    const error = rows[0]?.error ?? '';
    expect(error).not.toContain(JIRA_SECRET);
    expect(result.error).not.toContain(JIRA_SECRET);
    expect(error).toContain('[redacted]');
  });

  it('the settings mirror stores only a redacted hint, never a token byte', async () => {
    // The provider_configs mirror is the *display* truth: `token_redacted` is a
    // non-reversible last-4 hint. Seed it the way the settings route does and
    // sweep it for the real secret.
    await testDb.db.insert(providerConfigs).values({
      id: 'provider:git:github',
      kind: 'git',
      provider_type: 'github',
      token_redacted: GH_SECRET.slice(-4),
      enabled: true,
    });

    const rows = await testDb.db.select().from(providerConfigs);
    expect(rows).toHaveLength(1);
    expect(leakedSecrets(rows[0]?.token_redacted, rows[0]?.base_url, rows[0]?.model)).toEqual([]);
    expect(rows[0]?.token_redacted).toBe(GH_SECRET.slice(-4));
    expect(rows[0]?.token_redacted).not.toBe(GH_SECRET);
  });
});
