/**
 * Provider-settings routes (Phase 3 day-02 §3.4) — the human-facing surface over
 * the MCP connection layer and its `provider_configs` mirror.
 *
 * Two truths, kept separate by design (day-02 §6):
 *
 *  - `mcp.config.json` is the **connectivity** truth: which hosts exist, what
 *    transport each uses, and which `tokenEnv` *names* each credential. The
 *    {@link McpServerRegistry} parsed from it is the only place a host is
 *    declared.
 *  - `provider_configs` rows are the **display** truth: `enabled` + a
 *    non-reversible `token_redacted` hint + a `base_url` override, mirrored from
 *    the config for the settings UI.
 *
 * A token *value* never crosses this boundary: `GET` returns only the last-4
 * `tokenHint`, and `PUT` writes `enabled` (and echoes the hint) — never a secret.
 *
 * Both endpoints are ADMIN-guarded (`requireRole(Role.Admin)`): configuring a
 * provider is an operator action, and even the hint list is internal.
 */

import type { FastifyInstance } from 'fastify';

import { ProviderKind, Role } from '@harness/domain';
import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { providerConfigs } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { McpServerRegistry } from '@harness/mcp';

/** `PUT` body: per-server enabled toggle, keyed by the server name. */
interface ProvidersBody {
  readonly providers?: Record<string, boolean>;
}

/** A host is a ticket provider only when its name is `jira`; everything else is git. */
function kindFor(name: string): 'git' | 'ticket' {
  return name === 'jira' ? ProviderKind.Ticket : ProviderKind.Git;
}

/** Deterministic `provider_configs.id` — one row per host, never a random UUID. */
function providerId(kind: 'git' | 'ticket', providerType: string): string {
  return `provider:${kind}:${providerType}`;
}

/**
 * Read the human-facing provider list: registry entries (the connectivity truth)
 * joined with the enabled flag from the `provider_configs` mirror (default `true`
 * until a row is written). Only redacted hints leave the function.
 */
async function readProviders(db: DrizzleDB, registry: McpServerRegistry): Promise<{ providers: unknown[] }> {
  const rows = await db.select().from(providerConfigs);
  const enabledByKey = new Map(rows.map((r) => [`${r.kind}:${r.provider_type}`, r.enabled]));
  const providers = registry.entries().map((entry) => {
    const kind = kindFor(entry.name);
    return {
      name: entry.name,
      kind,
      providerType: entry.name,
      transport: entry.transport,
      tokenHint: entry.tokenHint ?? null,
      enabled: enabledByKey.get(`${kind}:${entry.name}`) ?? true,
      ...(entry.url !== undefined ? { baseUrl: entry.url } : {}),
    };
  });
  return { providers };
}

/** Register `GET`/`PUT /api/settings/providers` over the wired container. */
export function registerSettingsRoutes(app: FastifyInstance, container: Container): void {
  const canAdmin = requireRole(container, Role.Admin);
  const registry = container.resolve<McpServerRegistry>(TOKENS.McpServerRegistry);
  const db = container.resolve<DrizzleDB>(TOKENS.Db);

  app.get('/api/settings/providers', { preHandler: canAdmin }, () => readProviders(db, registry));

  app.put<{ Body: ProvidersBody }>('/api/settings/providers', { preHandler: canAdmin }, async (request, reply) => {
    const body = request.body?.providers ?? {};
    const known = new Set(registry.list());
    const unknown = Object.keys(body).filter((name) => !known.has(name));
    if (unknown.length > 0) {
      return reply.code(400).send({ error: `unknown provider(s): ${unknown.join(', ')}` });
    }

    for (const entry of registry.entries()) {
      const enabled = body[entry.name];
      if (typeof enabled !== 'boolean') {
        continue; // absent from the payload → leave the stored state unchanged
      }
      const kind = kindFor(entry.name);
      const tokenRedacted = entry.tokenHint;
      const baseUrl = entry.url;
      await db
        .insert(providerConfigs)
        .values({
          id: providerId(kind, entry.name),
          kind,
          provider_type: entry.name,
          enabled,
          ...(tokenRedacted !== undefined ? { token_redacted: tokenRedacted } : {}),
          ...(baseUrl !== undefined ? { base_url: baseUrl } : {}),
        })
        .onConflictDoUpdate({
          target: providerConfigs.id,
          set: {
            enabled,
            ...(tokenRedacted !== undefined ? { token_redacted: tokenRedacted } : {}),
            ...(baseUrl !== undefined ? { base_url: baseUrl } : {}),
          },
        });
    }

    return readProviders(db, registry);
  });
}
