# Operations — Phase 3 procedures

> **Status:** v1.0-candidate (Phase 3 as-built) — pending Day 40 exit review.
> Companion to [README.md](README.md) (incident-oriented) and
> [audit-queries.md](audit-queries.md) (copy-paste SQL). These are the *planned*
> procedures for the Phase-3 stack: provider-token rotation, write-back audit,
> learning-loop HOLD, the `rank_method` kill-switch, and the durable-queue flag.
> If a command here doesn't work as written, that is a doc bug — fix it, don't
> improvise in an incident.

**Scoping facts:** one API process, one Postgres, one `mcp.config.json`
(resolved via `MCP_CONFIG_PATH`, default `./mcp.config.json`). The API listens on
`localhost:3000`. Admin routes require an `Role.Admin` session cookie. The
database is reachable with:

```bash
docker compose exec -T postgres psql -U harness -d harness
```

---

## OP-1 — Rotate / redact a provider token

**Why.** Git/Jira credentials are a single point of compromise. The harness holds
*no clear-text token* anywhere it persists: `provider_configs.token_redacted` is a
non-reversible last-4 hint for display only, and `mcp.config.json` stores a
`tokenEnv` *name* — never a value. The real token lives in the MCP server's
environment (the process that launches the MCP subprocess / sets SSE headers) and
is injected at connect time. Rotating means changing the secret *at its source*;
there is nothing to scrub inside the harness.

**Where the truth lives (two truths, by design):**

| Truth | File / table | Holds |
| --- | --- | --- |
| Connectivity | `mcp.config.json` (via `MCP_CONFIG_PATH`) | which hosts exist, transport, and the `tokenEnv` *name* |
| Display | `provider_configs` | `enabled` + `token_redacted` hint + `base_url`, mirrored for the settings UI |

**Procedure:**

1. Identify the env-var name each host reads its token from — it is the `tokenEnv`
   in the config, never a stored value:

   ```bash
   cat "${MCP_CONFIG_PATH:-./mcp.config.json}" | grep -E '"(tokenEnv|transport|command|url)"'
   # e.g. "github" → tokenEnv GITHUB_TOKEN, stdio; "jira" → tokenEnv JIRA_TOKEN, sse
   ```

2. Rotate the secret **at the credential source** (the environment the MCP server
   is launched from — your deploy's secret store / the shell that runs
   `pnpm dev`). E.g. replace the value of `GITHUB_TOKEN` there.

3. Restart the API so the registry re-parses the config and reconnects with the new
   token:

   ```bash
   # stop pnpm dev (Ctrl-C), then:
   pnpm dev
   ```

   The config load is a **fast, loud guard**: a machine restart with a missing or
   empty `tokenEnv` throws `McpConfigError("mcp.config.json is not valid JSON"`-family)
   rather than serving an anonymous request — a legit rotated-but-unset token fails
   startup, which is the correct behaviour. Set the new value *before* restarting.

4. Confirm nothing entered the DB in the clear. `provider_configs` must show only
   the last-4 hint (or `••••` for a short secret):

   ```bash
   docker compose exec -T postgres psql -U harness -d harness \
     -c "SELECT kind, provider_type, token_redacted, enabled FROM provider_configs ORDER BY provider_type;"
   ```

   **Assertion:** `token_redacted` is at most 4 characters, and no column anywhere
   in `provider_configs` holds the full credential. If you ever see a full token in
   that table, treat it as a data breach: rotate immediately and redact the row.

5. Confirm the settings surface agrees (ADMIN only — returns `tokenHint`, never a
   value):

   ```bash
   curl -s localhost:3000/api/settings/providers \
     --cookie 'sid=<admin-session>'
   ```

**Escalate when:** a restart does not throw on a missing token (it should), or a
full token is visible in `provider_configs`/settings output — both are code bugs.

---

## OP-2 — Prove write-back is OFF, then read the audit

**Why.** "We wrote nothing externally" must be an *auditable fact*, not an
assumption. Write-back is behind a three-layer toggle and every *emitted* write is
appended to `writeback_log` (PENDING → SUCCEEDED / FAILED / DUPLICATE) with a
deterministic `dedup_key` (sha-256 over provider | target | action | normalized
payload). When toggled off, **no row exists** — so "no rows" is itself the proof.

**The three-layer toggle (all must be ON for a byte to leave the system):**

1. Env ceiling `WRITEBACK_ENABLED` (`apps/api/src/bootstrap`).
2. Config-surface per-provider `enabled` in `provider_configs`.
3. Request-level flag carried on the review/decision call.

**Procedure — prove OFF:**

```bash
# 1. the env ceiling (unset/false ⇒ no writes, period)
grep -E '^WRITEBACK_' .env 2>/dev/null || echo "WRITEBACK_* unset → OFF (default)"

# 2. per-provider enabled flags — any false row is a disabled destination
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT provider_type, enabled FROM provider_configs WHERE kind = 'git' OR kind = 'ticket';"

# 3. the audit is empty of *emit* attempts
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT count(*) AS writeback_rows FROM writeback_log;"
```

If `writeback_log` is empty while the toggle was off, that is the proof. Note the
**decision-time flag is itself persisted**: `review_decisions.writeback_enabled`
records the *effective* gate at decision time, so a `false` there states "nothing
external was written for this decision" even though `writeback_log` has no row.

**Procedure — read the audit when write-back IS on:**

```bash
# status distribution across the whole audit
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT status, action, provider, count(*) FROM writeback_log GROUP BY 1,2,3 ORDER BY 1,2;"

# the FAILED tail (what did not land, and why)
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT created_at, provider, action, external_id, error FROM writeback_log \
      WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 20;"

# idempotency behaving? DUPLICATE should outnumber raw retries (no double-post)
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT provider, action, external_id, dedup_key, status FROM writeback_log \
      ORDER BY created_at DESC LIMIT 20;"
```

**Escalate when:** `SUCCEEDED` rows exist while all three toggle layers read OFF
(a gate bypass), or two `SUCCEEDED` rows share one `dedup_key` (the partial unique
index `writeback_log_dedup_inflight_uniq` failed to catch a double-post).

---

## OP-3 — Interpret a learning-loop HOLD (`deploy = held`)

**Why.** HOLD is the loop working as designed, not a failure. The Day-33 closed
loop runs `evaluate → calibrate → deploy → observe`; the deploy stage is a
**measured PROMOTE/HOLD gate** (`decidePromotion`). A candidate is HELD when it
did *not* win its held-out comparison against the incumbent (no measured WIN), or
when judge-disagreement dominates the fit (the overfit alarm). A held candidate
parks at Deploy — the cycle still **completes with outcome `held`**, and the
loop feeds forward into the next Evaluate window. Nothing is applied; the hot-path
`WeightsProvider` keeps returning the placeholder.

**Command — read HOLD from the event trail:**

```bash
# a HOLD surfaces twice: per-stage (deploy status=held) and per-cycle (outcome=held)
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT occurred_at, event_type, payload FROM event_log \
      WHERE event_type IN ('learning.stage_completed','learning.loop_completed') \
        AND (payload->>'status' = 'held' OR payload->>'outcome' = 'held') \
      ORDER BY occurred_at DESC LIMIT 20;"
```

**How to interpret:**

| Signal | Meaning | Action |
| --- | --- | --- |
| `deploy` stage `status = held` | candidate did not clear the promotion gate | none — expected on a non-WIN cycle |
| `loop_completed` `outcome = held` | cycle ran end-to-end, candidate parked, feed-forward advanced | none — the loop is healthy |
| `loop_completed` `outcome = completed` **and** `promoted = false` | empty window or clean non-promote | none |
| `promoted = true` | a candidate won a measured comparison | adopt it **explicitly** — the loop never applies weights on its own |
| HOLD **every** cycle for many windows | the incumbent is not being beaten (or judge dominates) | tuning/product decision, not an ops fix |

**Escalate when:** a `held` cycle fails to advance the feed-forward cursor (the
next cycle re-scans the same window — check successive `next_since` values), or
`promoted = true` is observed but the hot path still serves the placeholder with
no adoption step (a wiring gap). Inspect the fit before overriding: the
`detail` on the `deploy` stage carries the guardrail reason.

---

## OP-4 — `rank_method` kill-switch (force `keyword`)

**Why.** Hybrid / RAG-Fusion ranking are *built and reachable* but must never win
the default without a measured live A/B. `DEFAULT_RANK_METHOD` is held at
`keyword` (the Day-29 replay returned a toss-up). The kill-switch is the ability
to force the *served* default back to `keyword` — and to confirm it is keyword —
without touching code. Selection is configuration, not code: the resolver treats
an absent/unknown method as `keyword`, and a mis-spelled `rank_method` degrades to
`keyword` (a degraded ranking, not a crash).

**Command — confirm the served default is keyword:**

The live `resolveContext` path resolves through `RetrieverFactory.resolve()` with
the compiled `DEFAULT_RANK_METHOD` (keyword). Verify from source — there is no
runtime flag to flip, which is itself the kill-switch guarantee:

```bash
# 1. the compiled default (must read keyword)
grep -rn "DEFAULT_RANK_METHOD" packages/context-engine/src/retrieval/retriever-factory.ts

# 2. the live path resolves through the keyword default (bootstrap comment)
grep -n "rank_method stays keyword" apps/api/src/bootstrap.ts

# 3. the shadow is OFF the hot path (semantic retriever never read by resolveContext)
grep -n "resolveWithShadow\|SemanticRanker" apps/api/src/bootstrap.ts
```

**Flipping it back to `keyword`** (if a deployment ever promotes hybrid on a
measured WIN and then needs to roll back) is a one-line config change:
`DEFAULT_RANK_METHOD = RANK_METHOD_KEYWORD` in `retriever-factory.ts` — reversible
in seconds, no DB migration. The semantic shadow keeps *measuring* either way
(writes `shadow_rank_comparisons`) without affecting the hot path.

**Escalate when:** `resolveContext` is observed serving a non-keyword ranking while
the caller sent no explicit `rank_method` (a default leak), or a large
`shadow_rank_comparisons` divergence appears — both warrant an `eval:ab-report`
against the replay corpus before any cutover.

---

## OP-5 — Durable-queue flag `EVENT_TRANSPORT`

**Why.** The event bus behind `IEventBus` is an optional transport swap. The
default is the zero-config, in-process `EventEmitter`; `EVENT_TRANSPORT=redis|sqs`
opts into a durable `RedisEventsBus` **only** where the operator has wired a
`StreamTransport` adapter (the repo ships no broker SDK — a durable deployment
supplies its own). Fail-fast is deliberate: an unknown value throws at startup, so
a typo can never silently fall back to in-process and drop durability.

**The transport contract:**

| Value | Behaviour | Needs |
| --- | --- | --- |
| `inproc` (default) | zero-config `InProcessEventBus` | nothing |
| `redis` | durable `RedisEventsBus` over a `StreamTransport` | an adapter + broker |
| `sqs` | durable `RedisEventsBus` over an SQS `StreamTransport` | an adapter + queue |
| anything else | startup throws | — (fix the typo) |

**Procedure — select the in-process default (what local dev runs):**

```bash
# unset or inproc → the zero-config bus; nothing more is required
grep -E '^EVENT_TRANSPORT=' .env 2>/dev/null || echo "EVENT_TRANSPORT unset → inproc"
```

**Procedure — opt into a durable broker:**

```bash
# must be paired with a wired StreamTransport adapter, or buildEventBus() throws
EVENT_TRANSPORT=redis pnpm dev
```

**Procedure — confirm what you actually selected:**

```bash
# the resolver is the single authority; grep it, or just trust the startup log
grep -n "EVENT_TRANSPORT" packages/event-bus/src/transport-resolver.ts
```

**Escalate when:** a deployment *expects* durability but the log shows in-process
(the env var isn't reaching the process — a launch-profile miss, not a bus bug), or
a `redis`/`sqs` selection starts without error despite no adapter being wired
(impossible by construction — `buildEventBus` throws without `options.transport`).

---

## Appendix — token secret hygiene checklist

- **Never commit** a token or an `mcp.config.json` — the example file ships
  `mcp.config.example.json` with `tokenEnv` references only; the real `mcp.config.json`
  is git-ignored.
- `provider_configs` stores `token_redacted` (≤ 4 chars) only; the value is reduced
  by `redactToken` at config-load time and discarded.
- The MCP layer resolves the token at **connect time** from `process.env[tokenEnv]`
  and reduces it to a non-reversible hint — the value never enters the returned
  config object or the DB.
- On any suspicion of leakage, run OP-1 (rotate + re-assert the redaction) and
  OP-2 (prove nothing was written externally).