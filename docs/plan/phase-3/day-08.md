# Day 08 — `writeback_log` Audit + Idempotency (No Duplicate Comments)

| | |
|---|---|
| **Week** | 2 — Write-back |
| **Spec refs** | Architecture §7 (append-only event_log recomputed projections); Phase-3 README §3, §7 (writeback_log exit criterion) |
| **Estimated effort** | 6h |
| **Prerequisites** | Days 06–07 (`WriteBackService` + MCP-backed write-back across all hosts) |

---

## 1. Objectives

By end of day you will have:

1. A `writeback_log` table recording **every external write attempt** — provider, intent, dedup key, outcome (`SUCCEEDED`/`FAILED`), external ref, and timestamp.
2. Idempotency: a deterministic dedup key per intent so a retried `write()` never double-posts a comment to the same external target.
3. The service writes the log *before* the external call (intent) and updates the outcome *after* (result) — so a crash leaves an auditable `FAILED`/`IN_PROGRESS` row, never a silent gap.
4. Tests proving: same intent twice → one external call, one successful row + one skipped-for-duplicate.

The audit + idempotency layer makes write-back safe to retry — the prerequisite for the Day 09 toggle.

---

## 2. Design Decisions

### 2.1 Schema (`@harness/db`)

```typescript
export const writebackLog = pgTable('writeback_log', {
  id:           text('id').primaryKey(),          // uuidv7
  provider:     text('provider').notNull(),
  external_id:  text('external_id').notNull(),
  action:       text('action').notNull(),         // COMMENT | STATUS | LABEL | TRANSITION
  dedup_key:    text('dedup_key').notNull(),
  outcome:      text('outcome').notNull(),        // SUCCEEDED | FAILED | DUPLICATE
  external_ref: text('external_ref'),             // host id/url of the write (nullable on FAILED)
  error:        text('error'),                    // redacted error, never token bytes
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dedupIdx: index('writeback_dedup_idx').on(t.dedup_key),
  providerIdx: index('writeback_provider_idx').on(t.provider, t.external_id),
}));
```

`dedup_key = sha256(provider | externalId | action | normalized body/label/toState)`. Normalization (`trim`, collapse whitespace) makes a slightly-reformatted retry dedup as the same intent.

### 2.2 Claim-then-write, not check-then-write

Idempotency is enforced by a **unique partial index** on `dedup_key` where `outcome = 'SUCCEEDED'` — a concurrent duplicate that races the insert fails the uniqueness constraint and is marked `DUPLICATE`. No read-then-assert window.

### 2.3 Audit writes are append-only and redacted

`writeback_log` is an append-only record; error strings go through `redactProviderConfig()` so no token/secret leaks into the log. The log is the Phase-3 answer to "OFF = nothing external, and we can prove it."

### 2.4 Service change

`write()` becomes: normalize → compute key → insert `IN_PROGRESS` (or fail duplicate → `DUPLICATE`) → call adapter → update `SUCCEEDED`/`FAILED`. If the toggle is OFF, `write()` short-circuits before the log (nothing external = nothing to audit); a `SKIPPED` marker is optional.

---

## 3. Tasks

### 3.1 Schema + migration (60 min)

- [ ] `packages/db/src/schema/writeback-log.ts` (§2.1) + migration.

### 3.2 Dedup key + record store (75 min)

- [ ] `packages/writeback/src/dedup.ts` — `dedupKey(intent)` with normalization.
- [ ] `writebackLogStore` — insert/update-outcome/query-by-key.

### 3.3 Service rewrite for claim-then-write (90 min)

- [ ] `write()` → log in-progress → adapter → update outcome; unique-index duplicate → `DUPLICATE`.

### 3.4 Toggle short-circuit audit (30 min)

- [ ] OFF → no log, no external call; document the "prove OFF" query.

### 3.5 Tests (90 min)

- [ ] Same intent twice → one external call, one SUCCEEDED + one DUPLICATE.
- [ ] Concurrent duplicate (Promise.all) → uniqueness catches the loser.
- [ ] Crash between insert and adapter → row left auditable (simulate adapter throw).
- [ ] Redaction: `error` never contains token bytes.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/writeback-log.ts` | `writeback_log` schema |
| `packages/db/migrations/0xxx_writeback_log.sql` | Migration |
| `packages/writeback/src/dedup.ts` | `dedupKey` + normalization |
| `packages/writeback/src/writeback-log-store.ts` | Append/update log store |
| `packages/writeback/src/writeback-service.ts` (updated) | Claim-then-write idempotent flow |

---

## 5. Acceptance Criteria

- [ ] `writeback_log` table exists with a unique partial index on `dedup_key` (SUCCEEDED).
- [ ] Retried intent yields exactly one external call; the second row is `DUPLICATE`.
- [ ] Concurrent identical intents produce one SUCCEEDED, one DUPLICATE.
- [ ] Adapter throw → row records `FAILED` with a redacted `error`.
- [ ] OFF (toggle) → zero `writeback_log` rows and zero external calls.
- [ ] `pnpm --filter @harness/writeback test` green.

---

## 6. Notes & Pitfalls

- **The unique partial index does the real work.** A plain pre-check is race-prone; only the DB constraint can close the concurrent window. Bundle the insert into the same transaction region you can retry against.
- **Normalize the body in the key, not the stored body.** If Formatting changes the comment, the external world sees the original; only the *dedup* fingerprint is normalized.
- **Error redaction is tested, not assumed.** The redaction test greps the stored error for token bytes — a caught `GitProviderError` that embeds an `Authorization` header would otherwise leak.
- **Day 09** promotes the env toggle to a per-review decision-time flag: OFF = nothing external.

---

*Next: [Day 09 — Write-back Toggle at Review-Decision Time; OFF = Nothing External](day-09.md)*