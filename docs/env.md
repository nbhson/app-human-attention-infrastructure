# Environment Variables

> **Source of truth:** `apps/api/src/bootstrap.ts` (container wiring) + `.env.example`. Code defaults are authoritative; `.env.example` may override to gentler provider defaults (see `REVIEW_MAX_*` note). Every var below is `string` in `process.env`; helpers like `envInt()` parse ints.

Copy `.env.example` → `.env` and fill what you need. Unset ⇒ default shown. Only `DATABASE_URL` is required to boot; everything else falls back to a local mock/null.

## 1. Core

| Var | Default | Required | Effect | Code ref |
|---|---|---|---|---|
| `DATABASE_URL` | — | **yes** | Postgres DSN (`postgres://harness:harness@localhost:5432/harness`) | `bootstrap.ts:229` — throws if unset |
| `NODE_ENV` | `development` | no | `production` enforces `JWT_SECRET≥32b` + forbids `APP_CORS_ORIGINS=*` | `bootstrap.ts:263`, `buildApp` in `app.ts` |
| `APP_URL` | `http://localhost:3000` | no | Absolute URL for OIDC callback (`/api/auth/callback`) | `routes/auth.ts:65` |
| `APP_CORS_ORIGINS` | `http://localhost:3000` | no | Comma-separated allowed origins (credentials, `Vary: Origin`). `*` rejected in prod | `buildApp` in `app.ts` |
| `SANDBOX_ROOT` | `./sandbox` | no | Filesystem root for PR clones / worktrees (`mkdirSync` at boot) | `bootstrap.ts:209` |

## 2. AI provider (review)

| Var | Default | Effect | Code ref |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | unset | When set → `AnthropicProvider`; overrides `AI_BASE_URL` | `bootstrap.ts:183` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Model id when using Anthropic | `bootstrap.ts:167` |
| `AI_BASE_URL` | unset | OpenAI-compatible `/chat/completions` endpoint (openai/gemini/opencode/custom) | `bootstrap.ts:186` |
| `AI_API_KEY` | `""` | Key for `AI_BASE_URL` | `bootstrap.ts:189` |
| `AI_MODEL` | `gpt-4.1` (or `mock` when both providers unset) | Model id for `OpenAICompatibleProvider` | `bootstrap.ts:176` |
| `AI_PROVIDER` | `custom` | Stamp on report provenance (`openai\|gemini\|opencode\|custom`) | `bootstrap.ts:172` |
| `AI_TIMEOUT_MS` | `600000` (10 min) | LLM request timeout — sized to full 32k budget at ~65 tok/s | `bootstrap.ts:198` |
| `AI_MAX_TOKENS` | `32000` | `maxTokens` for every `ReviewAgent` call | `bootstrap.ts:644` |

> **Provider resilience (code defaults, not env):** `OpenAICompatibleProvider` retries transient faults (`timeout`/`network`/`429`/`502`/`503`/`504`) up to 2 extra attempts with capped exponential backoff + jitter (`maxRetries`, default 2). `GitHubProvider`/`JiraProvider` apply the same policy per REST call (30s `AbortSignal` timeout, 2 retries, transient-only — programming errors never retry). Tune via constructor args, not env.
| `MOCK_LLM_SCRIPT` | unset | Path to canned `MockScript` JSON (e2e/tests) | `bootstrap.ts:149` |

## 3. Review pipeline

| Var | Default | `.env.example` | Effect | Code ref |
|---|---|---|---|---|
| `REVIEW_MAX_BATCH_SIZE` | `5` | `10` | Files per AI batch (large PRs split into parallel batches) | `bootstrap.ts:660` |
| `REVIEW_MAX_BATCH_TOKENS` | `30000` | `10000` | Token budget per batch | `bootstrap.ts:661` |
| `REVIEW_TWO_PASS` | `false` (code) / `true` (example) | `true` | Lightweight summary pass first, then deep review of high/medium risk files | `bootstrap.ts:662` |
| `REVIEW_MAX_CONCURRENCY` | `4` | `4` (commented) | Max concurrent AI requests | `bootstrap.ts:663` |

> Either default is valid; code default is authoritative. Lower values are gentler on rate-limited providers.

## 4. Git / Jira providers + MCP

| Var | Default | Effect | Code ref |
|---|---|---|---|
| `GITHUB_TOKEN` | unset | GitHub access → `GitHubProvider`; unset ⇒ `null` (ingest fails with clear 404/422) | `bootstrap.ts:600` |
| `GITHUB_BASE_URL` | `https://api.github.com` | Override for GHES | `bootstrap.ts:604` |
| `JIRA_TOKEN` | unset | Jira access; both `JIRA_TOKEN` + `JIRA_BASE_URL` required ⇒ `JiraProvider` else `null` | `bootstrap.ts:608` |
| `JIRA_BASE_URL` | unset | Jira site URL | `bootstrap.ts:608` |
| `GITLAB_TOKEN` | unset | Referenced as `tokenEnv` in `mcp.config.json` (never stored in DB) | `mcp.config.example.json` (`gitlab` server) |
| `GITLAB_PERSONAL_ACCESS_TOKEN` | unset | Same PAT value as `GITLAB_TOKEN` — the name `@zereight/mcp-gitlab` reads via `StdioTransport` env | `mcp-git-mapper.ts`, `transport.ts:70` |
| `GITLAB_API_URL` | `https://gitlab.com/api/v4` | Required for self-hosted GitLab (e.g. `https://gitlab.xxx.org/api/v4`) | `@zereight/mcp-gitlab` docs |
| `BITBUCKET_TOKEN` | unset | Same as above | `mcp.config.example.json` (`bitbucket` server, stdio local default) |
| `MCP_CONFIG_PATH` | `./mcp.config.json` | Path to the one MCP config file (`loadMcpConfig`) | `bootstrap.ts:623` |

## 5. Write-back gates (fail-safe 3-layer toggle)

| Var | Default | Effect | Code ref |
|---|---|---|---|
| `WRITEBACK_ENABLED` | `ON` (unset ⇒ armed) | Global ceiling — `0` disables all external writes fleet-wide | `writeback-gate.ts`, `operations.md` OP-2 |
| `WRITEBACK_GITHUB` | `ON` | Per-provider kill for GitHub | `packages/writeback` |
| `WRITEBACK_GITLAB` | `ON` | Per-provider kill for GitLab | `packages/writeback` |
| `WRITEBACK_BITBUCKET` | `ON` | Per-provider kill for Bitbucket | `packages/writeback` |
| `WRITEBACK_JIRA` | `ON` | Per-provider kill for Jira | `packages/writeback` |

Layer 3 is the per-decision `writeback: true` flag on `POST /api/reviews/:id/decision` (decision route in `routes/reviews.ts`). All three must be armed for an external `COMMENT`/`STATUS` to fire.

## 6. Verification + sandbox

| Var | Default | Effect | Code ref |
|---|---|---|---|
| `VERIFY_REVIEW_ENABLED` | `ON` (unset ⇒ enabled; `0`/`false` ⇒ `SKIPPED`) | Clone → build → test verifier for every review (`ReviewVerificationService`) | `bootstrap.ts:708` |
| `VERIFY_SANDBOX_ENABLED` | `OFF` | `SandboxedCheck` (Docker) vs in-process `CompileCheck` | `bootstrap.ts:552` |
| `VERIFY_SANDBOX_IMAGE` | `harness-verify:node20` | Docker image for sandbox | `bootstrap.ts:556` |
| `VERIFY_SANDBOX_CPU` | `1.0` | CPU limit for sandbox | `bootstrap.ts:559` |
| `VERIFY_SANDBOX_MEMORY` | `512m` | Memory limit | `bootstrap.ts:560` |
| `VERIFY_SANDBOX_TIMEOUT_S` | `30` | Per-check sandbox timeout (s) | `packages/sandbox` |
| `VERIFY_CLONE_TIMEOUT_S` | `600` | Clone+verify budget (s) for `SandboxRunner` | `bootstrap.ts:689` |
| `SANDBOX_ROOT` | `./sandbox` | Same as Core — duplicated here for discoverability | `bootstrap.ts:209` |

Build the image once: `docker build -t harness-verify:node20 packages/sandbox`.

## 7. Attention calibration (CF-2)

| Var | Default | Effect | Code ref |
|---|---|---|---|
| `FITTED_WEIGHTS_ENABLED` | `OFF` (`0`/`unset`) | `StaticWeightsAdapter` → `DbWeightsProvider` (reads latest `calibration_weights` promotion) | `bootstrap.ts:354` |

Only flip after `CalibrationJob` returns `PROMOTE` (`packages/attention-engine/README.md`, `packages/evaluation/README.md`). Day-12/15 fit did not beat the placeholder (HOLD).

## 8. Embeddings / object store / queue

| Var | Default | Effect | Code ref |
|---|---|---|---|
| `EMBEDDINGS_BASE_URL` | unset | Unset ⇒ `StubEmbedder`; set ⇒ `OpenAICompatibleEmbedder` | `bootstrap.ts:447` |
| `EMBEDDINGS_API_KEY` | `""` | Key for embeddings endpoint | `bootstrap.ts:453` |
| `EMBEDDINGS_MODEL` | `text-embedding-3-small` | Embedding model (dim 1536) | `bootstrap.ts:454` |
| `OBJECT_STORE_ENDPOINT` | unset | Unset ⇒ inline `snapshots` in Postgres (`threshold = Infinity`); set ⇒ `ObjectStoreContentStore` (S3/MinIO) | `bootstrap.ts:288` |
| `OBJECT_STORE_BUCKET` | `harness-artifacts` | Bucket for offload | `bootstrap.ts:292` |
| `OBJECT_STORE_REGION` | unset | Region | `bootstrap.ts:293` |
| `OBJECT_STORE_ACCESS_KEY_ID` | unset | S3 key | `bootstrap.ts:294` |
| `OBJECT_STORE_SECRET_ACCESS_KEY` | unset | S3 secret | `bootstrap.ts:295` |
| `OBJECT_STORE_PREFIX` | `artifacts/` | Key prefix | `bootstrap.ts:303` |
| `OBJECT_STORE_THRESHOLD_BYTES` | `1048576` (1 MiB) when object store configured; `Infinity` otherwise | Offload threshold | `bootstrap.ts:308` |
| `EVENT_TRANSPORT` | `inproc` | `inproc` (in-memory) / `redis` / `sqs` — durable swap behind same `IEventBus` | `packages/event-bus/src/transport-resolver.ts` |

`redis`/`sqs` require an operator-supplied `StreamTransport` adapter (repo ships `InMemoryStreamTransport` for demo/tests; no live broker SDK is bundled).

## 9. Identity / session

| Var | Default | Effect | Code ref |
|---|---|---|---|
| `OIDC_MOCK` | `true` (dev) | `true` ⇒ `MockOidcProvider`; `false` ⇒ `OpenIdClientProvider` | `bootstrap.ts:244` |
| `MOCK_OIDC_SUB` | `mock\|local-user` | Subject for mock login | `bootstrap.ts:246` |
| `MOCK_OIDC_EMAIL` | `local@example.com` | Email for mock login | `.env.example:82` |
| `MOCK_OIDC_NAME` | `Local Reviewer` | Display name for mock login | `.env.example:83` |
| `OIDC_ISSUER_URL` | unset | Required when `OIDC_MOCK=false` | `bootstrap.ts:252` |
| `OIDC_CLIENT_ID` | unset | Required when `OIDC_MOCK=false` | `bootstrap.ts:252` |
| `OIDC_CLIENT_SECRET` | unset | Required when `OIDC_MOCK=false` | `bootstrap.ts:252` |
| `JWT_SECRET` | `dev-only-insecure-secret` (dev) | ≥32 bytes; throws in `production` if insecure/empty | `bootstrap.ts:263` |
| `COOKIE_SECURE` | `false` | `true` only behind TLS — `true` on plain HTTP drops the `sid` cookie → 401 loop | `routes/auth.ts:71`, `docs/dev-guide.md:92` |
| `SESSION_TTL_MS` | `604800000` (7 days) | Session lifetime | `bootstrap.ts:111` |

## Quick grep

```sh
grep -E '^(DATABASE_URL|AI_|REVIEW_|GITHUB_|JIRA_|MCP_|WRITEBACK_|VERIFY_|FITTED_|EMBEDDINGS_|OBJECT_STORE_|EVENT_TRANSPORT|OIDC_|JWT_|COOKIE_|APP_)' .env.example
```

See also: `docs/dev-guide.md` §Environment Variables (human-friendly), `docs/deploy.md` (prod constraints), `docs/runbook/operations.md` OP-1–OP-5 (operational toggles).
