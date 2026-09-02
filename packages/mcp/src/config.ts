/**
 * The `mcp.config.json` schema + loader — the *one file* that connects the
 * harness to GitHub/GitLab/Bitbucket/Jira (and any future MCP server).
 *
 * The file is declarative and secret-free: each entry names its transport
 * (`stdio` command + args, or an `sse` url) and a `tokenEnv` *reference*, never
 * a token. At load the token's presence is checked and reduced to a non-reversible
 * last-4 `tokenHint`; the value itself never enters the returned config object.
 *
 * Validation is hand-rolled (the codebase avoids a schema dependency): a
 * malformed file, unknown transport, or missing `tokenEnv` is a typed
 * {@link McpConfigError}, never a silent anonymous request.
 */

import { readFileSync } from 'node:fs';

import { McpClientError } from './errors.js';

/** A config-file error — indistinguishable from other MCP failures by callers. */
export class McpConfigError extends McpClientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'McpConfigError';
  }
}

export type McpTransportKind = 'stdio' | 'sse';

/** One connected server, after validation + token resolution. */
export interface McpServerEntry {
  readonly name: string;
  readonly transport: McpTransportKind;
  /** stdio: the subprocess binary. */
  readonly command?: string;
  /** stdio: fixed argv array (never a shell string — avoids shell-injection). */
  readonly args?: readonly string[];
  /** sse: the SSE endpoint URL. */
  readonly url?: string;
  /** sse: extra request headers (a self-hosted server may need a custom auth header). */
  readonly headers?: Record<string, string>;
  /** The env-var *name* the token lives under (a reference, not the value). */
  readonly tokenEnv?: string;
  /** Last-4 hint for display — the value never survives loading. */
  readonly tokenHint?: string;
}

/** The full parsed config. Empty when no file is present. */
export interface McpConfig {
  readonly servers: readonly McpServerEntry[];
}

/** Reduce a token to a non-reversible last-4 hint, never echoing a short secret. */
export function redactToken(value: string): string {
  if (value.length === 0) {
    return '';
  }
  if (value.length <= 4) {
    return '••••';
  }
  return value.slice(-4);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate + resolve `text` (the contents of `mcp.config.json`) against `env`.
 *
 * For every entry with a `tokenEnv`, the referenced env var must be present and
 * non-empty — that is the "fast, loud" guard against a silently-anonymous
 * request. The value is reduced to `tokenHint` and discarded.
 */
export function parseMcpConfig(text: string, env: Record<string, string | undefined> = process.env): McpConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new McpConfigError('mcp.config.json is not valid JSON', { cause });
  }
  if (!isRecord(raw) || !isRecord(raw['servers'])) {
    throw new McpConfigError('mcp.config.json must be { "servers": { ... } }');
  }
  const servers: McpServerEntry[] = [];
  for (const [name, entryRaw] of Object.entries(raw['servers'])) {
    servers.push(parseServerEntry(name, entryRaw, env));
  }
  return { servers };
}

/**
 * Read + parse the config at `path`. A missing file means "no MCP servers
 * configured" (the app still boots; providers resolve to null the way the
 * Phase-1 `GITHUB_TOKEN` path does). An unreadable or malformed file throws.
 */
export function loadMcpConfig(path: string, env: Record<string, string | undefined> = process.env): McpConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err && err.code === 'ENOENT') {
      return { servers: [] };
    }
    throw new McpConfigError(`cannot read MCP config at ${path}`, { cause });
  }
  return parseMcpConfig(text, env);
}

function parseServerEntry(name: string, raw: unknown, env: Record<string, string | undefined>): McpServerEntry {
  if (!isRecord(raw)) {
    throw new McpConfigError(`server "${name}" must be an object`);
  }
  const transport = raw['transport'];
  if (transport !== 'stdio' && transport !== 'sse') {
    throw new McpConfigError(`server "${name}": unknown transport "${String(transport)}"`);
  }
  const tokenEnv = typeof raw['tokenEnv'] === 'string' ? raw['tokenEnv'] : undefined;
  const tokenHint = tokenEnv === undefined ? undefined : resolveTokenHint(name, tokenEnv, env);
  const base: McpServerEntry = {
    name,
    transport,
    ...(tokenEnv === undefined ? {} : { tokenEnv }),
    ...(tokenHint === undefined ? {} : { tokenHint }),
  };

  if (transport === 'stdio') {
    if (typeof raw['command'] !== 'string') {
      throw new McpConfigError(`server "${name}": stdio transport requires "command"`);
    }
    const args = parseStringArray(raw['args'], `server "${name}" args`);
    return { ...base, command: raw['command'], ...(args === undefined ? {} : { args }) };
  }

  if (typeof raw['url'] !== 'string') {
    throw new McpConfigError(`server "${name}": sse transport requires "url"`);
  }
  const headers = parseStringRecord(raw['headers'], `server "${name}" headers`);
  return { ...base, url: raw['url'], ...(headers === undefined ? {} : { headers }) };
}

function resolveTokenHint(name: string, tokenEnv: string, env: Record<string, string | undefined>): string {
  const value = env[tokenEnv];
  if (value === undefined || value.length === 0) {
    throw new McpConfigError(`server "${name}": token env var "${tokenEnv}" is not set`);
  }
  return redactToken(value);
}

function parseStringArray(raw: unknown, label: string): readonly string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw) || raw.some((e) => typeof e !== 'string')) {
    throw new McpConfigError(`${label} must be an array of strings`);
  }
  return raw as readonly string[];
}

function parseStringRecord(raw: unknown, label: string): Record<string, string> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw) || Object.values(raw).some((e) => typeof e !== 'string')) {
    throw new McpConfigError(`${label} must be an object of string values`);
  }
  return raw as Record<string, string>;
}
