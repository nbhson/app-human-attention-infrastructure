# Week 5 Live Demo — Object Store → Sandbox → Cache, Integrated

*Phase 2 · day-25 checkpoint. A narrated runbook: prove the three Week-5 address
spaces — the content-addressed object store, the isolated sandbox, and the
context source cache — agree on a single `content_hash`, and read the whole week's
liveness off the Day-4 registry plus the Day-07 report's new sections.*

> Week 5 is the "integrated, not yet trusted" week. The deliverable is **not** a
> cut-over to sandbox-only verification. It is proof the new subsystems *feed
> each other* (object store → sandbox, cache → second run) while the served
> ranking stays keyword (`rankMethod = 'keyword'` in the report) and every fallback
> is *counted* rather than silent.

---

## 0. Prereqs & clean stack

```bash
docker compose down -v
docker compose up -d          # wait for postgres healthy
pnpm --filter @harness/db migrate   # applies migrations through 0030 (Spec 8 review enum)
pnpm dev                      # API on http://localhost:3000 for §2
```

The Week-5 counters exist on the registry at boot, before any traffic runs (that
is the point — a liveness signal must be *present* at zero, not appear on demand):

```bash
curl -s http://localhost:3000/metrics | grep -E 'harness_(sandbox|object_store)'
#   harness_sandbox_run_total 0
#   harness_sandbox_fallback_total 0
#   harness_sandbox_duration_seconds_count 0
#   harness_object_store_integrity_error_total 0
```

---

## 1. The object store feeds the sandbox a `content_hash`

Large artifacts offload their `content` to the object store (backend `object`),
small ones stay inline in Postgres (backend `db`). The discriminator is
`SnapshotStore`'s threshold; the read-back is content-addressed and hash-verified:

```text
packages/artifact-tracker/src/__tests__/diff-engine.test.ts
  ✓ resolves object-backed (offloaded) snapshot content through the ContentStore
packages/object-store/src/__tests__/content-store.test.ts
  ✓ get() returns a hash-verifying stream (digest drift → ContentIntegrityError)
packages/verification-engine/src/__tests__/sandboxed-check.test.ts
  ✓ maps exit 0 to PASSED
  ✓ falls back to the in-process check on SandboxInfraError, logging a warning
  ✓ parity: sandboxed and in-process verdicts agree on the same fixtures
```

The verification result carries the `content_hash` it verified (day-22 §3.3), so
the sandbox verdict and the object-store read are attributable to the same bytes.
An integrity drift on read-back is counted, then rethrown — never rendered as a
silently-wrong diff:

```bash
curl -s http://localhost:3000/metrics | grep 'harness_object_store_integrity_error_total'
```

---

## 2. Sandbox latency + fallback rate are **counted, not assumed**

`SandboxedCheck.run` records a `run` + `duration` on every container completion,
and a `fallback` on every `SandboxInfraError` before degrading to the in-process
parity path. The fallback rate is the single best liveness signal for the week:

```bash
curl -s http://localhost:3000/metrics | grep -E 'harness_sandbox_(run|fallback)_total|harness_sandbox_duration_seconds'
```

A non-zero `harness_sandbox_fallback_total` means the isolation you built is not
actually being used — the report surfaces it as `infra.sandboxFallbackRate` rather
than leaving it buried in a counter. The parity test above is the safety property
for the fallback path itself (in-process and sandboxed verdicts agree).

---

## 3. The second run hits the cache

The context source cache keys on `source_id + content_hash`; a second, *unchanged*
run serves from the cache with zero file reads. Re-run the same task and confirm
the miss → hit transition:

```bash
curl -s http://localhost:3000/metrics | grep -E 'harness_context_cache_(hit|miss)_total'
#   harness_context_cache_hit_total 1   (after the second collect)
#   harness_context_cache_miss_total 1  (from the first collect)
```

The mechanical proof is unchanged from Week 4 (zero-read `chmod 000` test), but
now the hit/miss pair also feeds the report's `infra.cacheHitRatio`
(`hits / (hits + misses)`), so the cache stops being a raw counter and becomes a
single ratio in one report:

```text
packages/context-engine/src/__tests__/context-cache.test.ts
  ✓ serves a hit with zero file reads (chmod 000 still collects)
```

---

## 4. The report renders shadow + infra + the rank invariant

Generate the report over a seeded window. Three new top-level sections sit
alongside the stable five-line `lines` array — the shadow signal is DB-backed
(`shadow_rank_comparisons`), the infra signal is a continuous-counter snapshot,
and the ranking invariant is rendered rather than assumed:

```bash
pnpm eval:report --once --from=2026-08-11T00:00:00Z --to=2026-08-18T00:00:00Z
```

```json
{
  "window": { "from": "…", "to": "…" },
  "generatedAt": "…",
  "lines": [ /* routing.precision, routing.recall, routing.escalationLeakage,
               efficiency.humanMinutesPerAccept, efficiency.inflationRatio */ ],
  "shadow": { "comparisons": 2, "meanRankCorrelation": 0.6 },
  "infra":  { "cacheHitRatio": 0.9, "sandboxFallbackRate": 0.0,
              "sandboxAvgDurationMs": 1200 },
  "rankMethod": "keyword"
}
```

- `shadow.meanRankCorrelation` is omitted (an honest hole) when no comparison in
  the window had ≥2 shared sources.
- `infra.cacheHitRatio` / `infra.sandboxFallbackRate` / `infra.sandboxAvgDurationMs`
  are omitted when their denominator is zero — no false `0` for "no traffic".
- `infra.objectIntegrityErrors` appears only when non-zero (absence = no drift).
- `rankMethod = 'keyword'` is the invariant made *visible*: it reduces the served
  `contexts.rank_method` (`phase1-keyword-dependency`) to the keyword-vs-semantic
  distinction that matters for the shadow-leak check.

> **Honest limit:** the `--once` CLI is a **fresh process**, so its `infra`
> snapshot reads the counters from *this* process's lifetime — typically zero.
> The live `/metrics` counters (§2) are the real continuous numbers. The
> structural guarantee of this checkpoint is that the report *renders* all three
> sections with honest holes; Day 27's end-to-end run wires a long-lived process
> into that snapshot so the holes fill with real numbers.

---

## 5. Code mode is attributable end-to-end

The tier-2 sandboxed tool calls (day-23) write a `code_mode_sessions` row with
`tool_calls`, so a code-mode run is unbroken from the `content_hash` it edited to
the approval it recorded:

```bash
psql "$DATABASE_URL" -c "SELECT id, code_mode_id, jsonb_array_length(tool_calls) AS calls,
                                approval_status
                         FROM code_mode_sessions ORDER BY created_at DESC LIMIT 5;"
```

This is the same address-space agreement as §1 — a session is attributable to the
snapshot it operated on, not to a loosely-coupled process id.

---

## Green gate before you leave Week 5

```bash
pnpm lint && pnpm -r typecheck && pnpm -r test
```