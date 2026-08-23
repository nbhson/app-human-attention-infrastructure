# Day 36 — Hardening: Write-back Idempotency, Token Redaction, Multi-provider Concurrency

| | |
|---|---|
| **Week** | 8 — Harden + exit |
| **Spec refs** | Phase-3 README §7 (exit criteria); Architecture §7 (token hygiene, append-only); Days 03/08 schemas |
| **Estimated effort** | 7h |
| **Prerequisites** | Days 08 (writeback_log), 03 (provider_configs redaction), 05 (registry) all live |

---

## 1. Objectives

By end of day you will have:

1. **Write-back idempotency hardened** — re-verify no duplicate comments under failure injection (concurrent retries, crash-between-insert-and-call) and close any gaps found since Day 08.
2. **Token redaction hardened** — a systematic sweep proving provider tokens are never logged, never in events, never in error bodies, across all new Phase-3 code paths.
3. **Multi-provider concurrency** — two reviews against two different providers (or two configs) resolve independently with no shared-token bleed, no cross-host race.
4. A hardening report summarizing findings + fixes.

This is the security/robustness pass before the Day 37 E2E and Day 40 exit review.

---

## 2. Design Decisions

### 2.1 Idempotency re-verified under fault injection

Day 08 shipped the unique partial index; today *attacks* it: concurrent duplicate intents, retry-after-crash, reformatted body dedup. Any path that produces a second external comment is a bug to close, not document.

### 2.2 Redaction is a tested invariant, not a convention

Add/strengthen the "grep emitted events + error bodies + log rows for token bytes" test that fails on any leak. The redaction boundary (`redactProviderConfig`) is enforced at the seam; today closes the remaining paths (adapter `error` strings, demos, ops endpoints).

### 2.3 Concurrency = config isolation

Each review resolves its provider from its own `provider_configs` row; tests assert two interleaved reviews (GitHub + GitLab) retrieve *their own* tokens/endpoints with zero cross-contamination, and that a scoped token can't read another host's row.

### 2.4 No live keys anywhere

Confirm `.env.example`-only hygiene across the whole repo (git grep for key patterns), including the new packages added this phase.

---

## 3. Tasks

### 3.1 Idempotency fault injection (90 min)

- [ ] Concurrent + crash + reformat retry scenarios; fix any double-write found.

### 3.2 Redaction sweep (90 min)

- [ ] Grep-for-token-bytes test across events/errors/logs; close leaks; verify `token_hint`-only anywhere a token is shown.

### 3.3 Concurrency isolation (90 min)

- [ ] Interleaved multi-provider tests; scoped-token isolation test.

### 3.4 Key hygiene audit (45 min)

- [ ] `git grep` for live-key patterns; confirm `.env.example`-only.

### 3.5 Hardening report (30 min)

- [ ] `docs/retros/phase3-hardening.md` — findings + fixes.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/writeback/src/__tests__/idempotency-fault.test.ts` | Fault-injection idempotency |
| `apps/api/src/__tests__/redaction-sweep.test.ts` | Token redaction sweep |
| `packages/git-provider/src/__tests__/concurrency.test.ts` | Multi-provider isolation |
| `docs/retros/phase3-hardening.md` | Hardening report |

---

## 5. Acceptance Criteria

- [ ] No duplicate external write under concurrent retry / crash / reformat.
- [ ] Token bytes absent from every event, error body, and log row (grep test green).
- [ ] Two interleaved reviews across two providers resolve independent configs with no bleed.
- [ ] No live key committed anywhere (git grep clean).
- [ ] `pnpm test && pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Attack the seams you built, don't trust them.** Day 08's index is only as strong as the paths that reach it; fault injection, not code review, is the proof.
- **Redaction failure is a security bug, not a style issue.** A leaked `Authorization` header in an error body is an incident; the grep test is the tripwire.
- **Concurrency bugs look like "wrong token used".** The isolation test must assert *which* host a request hit, not just that it succeeded.
- **Day 37:** E2E full system under Phase-3 infra + load profile.

---

*Next: [Day 37 — E2E Full System under Phase-3 Infra + Load Profile](day-37.md)*