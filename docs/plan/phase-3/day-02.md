# Day 02 — `mcp.config.json`: One File Connecting GitHub/GitLab/Bitbucket/Jira

| | |
|---|---|
| **Week** | 1 — MCP connectivity |
| **Spec refs** | Phase-3 README §3 (MCP config), §4 (repo root config file); Architecture §7 (token hygiene) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 01 (`@harness/mcp` client + `McpTransport`) |

---

## 1. Objectives

By end of day you will have:

1. A **single config file** — `mcp.config.json` at the repo root — that lists the MCP servers the harness connects to (GitHub, GitLab, Bitbucket, Jira), each with its transport (`command`/`args` for stdio, or `url` for SSE) and a **token reference**, not a token.
2. A `loadMcpConfig()` loader that validates the file against a Zod schema and resolves env-var references at startup — the only place a credential is named, never stored.
3. A `McpServerRegistry` that hands out a connected `McpClient` per entry, lazy-started and shared, so the reviews route talks to "the git provider" without caring which host it is.
4. Redaction tests proving a `provider_configs` write (the DB record that mirrors the config for the settings UI) stores `token_hint` (last-4) and never the secret.

The day turns `@harness/mcp` from a library into a **configurable connection layer** — the "one file to connect any tool" the product needs.

---

## 2. Design Decisions

### 2.1 The config file is declarative and secret-free

```jsonc
// mcp.config.json — repo root. The ONE place Git/ticket tools are declared.
{
  "servers": {
    "github":    { "transport": "stdio", "command": "npx", "args": ["-y", "@github/mcp-server"], "tokenEnv": "GITHUB_TOKEN" },
    "gitlab":    { "transport": "stdio", "command": "npx", "args": ["-y", "@gitlab/mcp-server"], "tokenEnv": "GITLAB_TOKEN" },
    "bitbucket": { "transport": "sse",   "url": "https://mcp.bitbucket.example/sse",          "tokenEnv": "BITBUCKET_TOKEN" },
    "jira":      { "transport": "sse",   "url": "https://mcp.atlassian.com/sse",              "tokenEnv": "JIRA_TOKEN" }
  }
}
```

- `tokenEnv` names an environment variable the *server subprocess* (or a header injector) reads — the file holds the reference, `.env`/secret store holds the value (same hygiene as `ANTHROPIC_API_KEY`).
- Tokens are **never inline**, never committed, never logged. A missing `tokenEnv` at startup is a fast, loud error, not a silent anonymous request.

### 2.2 One registry over N servers

```typescript
// packages/mcp/src/registry.ts
export interface McpServerRegistry {
  get(name: 'github' | 'gitlab' | 'bitbucket' | 'jira'): Promise<McpClient>;
  list(): string[];                                   // enabled server names
  closeAll(): Promise<void>;
}
```

The registry lazy-starts each client on first use and shares the process for its lifetime; `closeAll()` shuts every spawned subprocess at shutdown.

### 2.3 The DB record mirrors config for the human, not as a second source of truth

`mcp.config.json` is the source of truth for *connectivity*. A `provider_configs` row (`kind = 'git' | 'ticket'`) persists the *human-facing* state — enabled/disabled + `token_hint` (last 4) + `base_url` override — for the settings UI and toggle, with the same `redactProviderConfig()` boundary as the model config. Connectivity and display stay separate.

### 2.4 AI model config is untouched

The `kind = 'ai'` row — **api key + provider + base URL + model** — is read exactly as in Phase 1/2. MCP replaces *tools* only; the model connection is not routed through MCP.

---

## 3. Tasks

### 3.1 Config schema + loader (60 min)

- [ ] `packages/mcp/src/config.ts` — Zod schema for `mcp.config.json` (§2.1); `loadMcpConfig(path)` validates + resolves `tokenEnv` from `process.env` (value never enters the config object — only a redacted hint).
- [ ] Unit test: unknown transport, missing `tokenEnv`, malformed JSON → typed error.

### 3.2 `McpServerRegistry` (75 min)

- [ ] `packages/mcp/src/registry.ts` — lazy-start, share, `closeAll()`; mapping config entry → `StdioTransport`/`SseTransport` + `McpClient`.
- [ ] Test: two `get()` calls return the same client (single subprocess); `closeAll()` stops it.

### 3.3 `provider_configs` mirror (60 min)

- [ ] Extend the existing `provider_configs` schema use for `git`/`ticket` rows — enabled flag + `token_hint` + `base_url` override; **no** token column beyond the redacted hint.
- [ ] Redaction is applied on every read path (mirror of the model-config boundary).

### 3.4 Settings endpoint (45 min)

- [ ] `GET /api/settings/providers` — return the parsed server list (names + transports + hints), never the config's secrets.
- [ ] `PUT /api/settings/providers` — toggle enabled/disabled per server (writes the DB mirror; the file stays the connectivity truth).

### 3.5 Fixture config + tests (75 min)

- [ ] Ship a committed **example** `mcp.config.example.json` (stdin/SSE examples, placeholder `tokenEnv`) — the real `mcp.config.json` is git-ignored.
- [ ] Loader test against a temp file with an injected-fake env; registry test with the in-repo `McpTestServer`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/mcp/src/config.ts` | `mcp.config.json` schema + loader |
| `packages/mcp/src/registry.ts` | `McpServerRegistry` |
| `mcp.config.example.json` | Committed example (secret-free) |
| `packages/db/src/schema/provider-config.ts` (updated) | `git`/`ticket` mirror rows (enabled + token_hint) |
| `apps/api/src/routes/settings.ts` (updated) | Provider list/toggle endpoints (redacted) |
| `packages/mcp/src/__tests__/*.test.ts` | Loader + registry + redaction tests |

---

## 5. Acceptance Criteria

- [ ] `mcp.config.json` lists GitHub/GitLab/Bitbucket/Jira servers; each entry has `transport` + `tokenEnv`; the committed example contains no secret.
- [ ] `loadMcpConfig` resolves `tokenEnv` to a redacted hint only — the value never appears in any returned object or log.
- [ ] Registry hands out one shared client per server; `closeAll()` cleans up subprocesses.
- [ ] `GET /api/settings/providers` never returns a token; `PUT` toggles enabled state only.
- [ ] `grep -r "token" packages/mcp/src` (case-insensitive) surfaces no `token` value assignment outside the redaction/hint path.
- [ ] `pnpm lint` clean; real `mcp.config.json` git-ignored; `.env.example` documents the four `*_TOKEN` names as placeholders.

---

## 6. Notes & Pitfalls

- **The file is connectivity truth; the DB is display truth.** Don't let `provider_configs` drift into holding an actual token "for convenience" — that reintroduces the exact secret-sprawl the redaction boundary exists to stop.
- **`tokenEnv` is resolved once at startup, into a hint.** If a server needs a fresh token mid-flight (rotation), restart the harness — a long-lived process holding a live secret in memory is the anti-pattern Day 01's notes warned about.
- **stdio command must be a fixed array, not a shell string.** `npx` + args avoids shell-injection when a repo config is shared across machines.
- **SSE servers and self-hosted GitLab/Bitbucket** are the common real-world case — the schema already supports `url`; self-hosted is just another entry with a different `url`. No code.
- **Tomorrow (Day 03):** `MCPGitProvider` — map Git MCP tool output to the `PullRequest` domain shape.

---

*Next: [Day 03 — `MCPGitProvider`: Git MCP Tools → `PullRequest` Behind the `GitProvider` Seam](day-03.md)*