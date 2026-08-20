# Day 23 — Container Sandbox for Agent Code Mode (Spec 3 §14.3)

| | |
|---|---|
| **Week** | 5 — Sandbox, object store, Spec 8 |
| **Spec refs** | Spec 3 §14.3 (Code-Mode sandbox), §14.1 (tool tiers), §14.2 (rate limiting); Spec 7 §5.5 (shared sandbox); Spec 9 §3.2 (evidence) |
| **Estimated effort** | 8 hours |
| **Prerequisites** | Day 22 (shared `Sandbox` interface + Docker runtime); Phase-1 tool executor runs tools on the host process |

---

## 1. Objectives

By end of day you will have:

1. **Code-Mode tool execution moved into the sandbox** — the `write_file`/`run_command`/`read_file` tools execute *inside the shared `Sandbox`* (Spec 3 §14.3), not on the host, so generated code cannot touch the orchestration process or its filesystem.
2. The **tool-tier model enforced inside the container**: code tooling is split into read-only (tier 0) vs constrained-write (tier 1) vs auth-gated (tier 2) tools (Spec 3 §14.1), with the same sandbox from Day 22.
3. **Rate limiting applied to sandboxed execution** (Spec 3 §14.2) — bounded calls per tool per task, banding I/O, so a runaway generated-loop can't spin unbounded containers.
4. **Evidence integrity** — Code-Mode's sandboxed runs write a `code_mode_sessions` record with the container's `content_hash` and exit/timeout so there's a tamper-evident trail (Spec 9) for what actually executed.

Verification (Day 22) and generation (today) now share *one* sandbox. That shared abstraction is what makes "the thing generating code can't also validate it" a structural fact rather than a workflow rule.

---

## 2. Design Decisions

### 2.1 Same `Sandbox` interface, Code-Mode-flavored runs

`packages/sandbox` is not verification-specific; Code Mode composes it with a lower-level batch API (Spec 3 §14.3's batched tool calls):

```typescript
// packages/agent-runtime/src/code-mode/sandboxed-tools.ts
import { Sandbox } from '@harness/sandbox';

export class SandboxedToolExecutor {
  constructor(private sandbox: Sandbox, private rateLimiter: RateLimiter) {}
  async writeFile(session: CodeModeSession, relPath: string, content: string): Promise<ToolResult> {
    const run: SandboxRun = {
      command: ['bash', '-lc', `cat > "${relPath}" <<'EOF'\n${content}\nEOF`],
      image: 'harness-verify:node20',        // shared pinned image
      workdirContents: session.snapshot,     // the task's current workspace bytes
      limits: { cpu: '1', memory: '2g', timeoutSeconds: 30 },
      network: 'none',
    };
    return this.rateLimiter.throttle('write_file', () => this.sandbox.run(run));
  }
}
```

There is **one** `Sandbox` implementation (Docker runtime from Day 22). Code Mode adds tool-level *policies* (tiers + rate limits), not a second runtime.

### 2.2 Tool tiers — capability gating, not just naming (Spec 3 §14.1)

| Tier | Tools | Policy |
|------|-------|--------|
| 0 (read-only) | `read_file`, `ls`, `grep` | Sandboxed, read-only mounts; no `write_file` reachable |
| 1 (constrained write) | `write_file`, `run_test` | Sandboxed; writes land only in the workspace mount |
| 2 (auth-gated) | `run_command` (arbitrary), `git push` | Requires OPERATOR approval; still sandboxed + rate-limited |

The tier is enforced by *construction* in the sandbox (read-only mounts for tier 0; a single writable workspace mount for tier 1), not by a runtime `if` the generated code can talk its way past.

### 2.3 Rate limiting is per-tool + per-task (Spec 3 §14.2)

```typescript
// packages/agent-runtime/src/code-mode/rate-limiter.ts
interface RateLimiter {
  throttle(tool: string, run: () => Promise<ToolResult>): Promise<ToolResult>;
}
// config: { tool: 'write_file', maxCallsPerTask: 50, maxConcurrent: 2 }
```

The limiter bounds both *count* and *concurrency* per task, so a runaway loop (`while(true) write_file`) cannot fan out unbounded containers or write storms. On exceed → `ToolRateLimitError`, surfaced to the orchestrator, not the model.

### 2.4 Session record = evidence + attribution (Spec 9)

```sql
-- packages/db/migrations/0114_code_mode_sessions.sql
CREATE TABLE code_mode_sessions (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  workspace_content_hash text NOT NULL,   -- the bytes the session operated on
  tool_calls   jsonb NOT NULL DEFAULT '[]', -- [{tool, exitCode, timedOut, durationMs}]
  policy       jsonb NOT NULL,            -- tiers + rate limits in force
  CONSTRAINT fk_task FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

Every sandboxed call appends to `tool_calls`; the session's `workspace_content_hash` pins the environment. Together they make "what ran, on what bytes, under what policy" answerable — the same attributability Day 22 gave verification.

---

## 3. Tasks

### 3.1 Sandboxed tool executor (120 min)

- [ ] `packages/agent-runtime/src/code-mode/sandboxed-tools.ts` (§2.1) — `writeFile`/`readFile`/`runCommand`/`runTest` composed over `Sandbox`.
- [ ] Reuse the shared `harness-verify:node20` image; no Code-Mode-specific image.

### 3.2 Tool tiers (90 min)

- [ ] `packages/agent-runtime/src/code-mode/tiers.ts` — enforce §2.2's table; tier-2 tools require OPERATOR approval.
- [ ] Read-only mounts for tier 0; single writable workspace mount for tier 1.

### 3.3 Rate limiter (60 min)

- [ ] `rate-limiter.ts` (§2.3) + config (`maxCallsPerTask`/`maxConcurrent` per tool); `ToolRateLimitError`.

### 3.4 Session record + evidence (60 min)

- [ ] Migration `0114_code_mode_sessions.sql` (§2.4) + `CodeModeSession` writer on each call.

### 3.5 Wire into agent loop + DI (60 min)

- [ ] Agent runtime resolves `TOKENS.Sandbox` + `TOKENS.RateLimiter`; Code-Mode path uses `SandboxedToolExecutor`; `docs/architecture/wiring-map.md`.

### 3.6 Tests (90 min)

- [ ] Tier 0 cannot write (read-only mount asserted via a `write` attempt → fail).
- [ ] Tier 1 write lands in workspace mount only; attempt to write outside → fail.
- [ ] Timer/rate: calling `write_file` beyond `maxCallsPerTask` → `ToolRateLimitError`.
- [ ] Session row: after a run, `code_mode_sessions` has `tool_calls` populated + matching `workspace_content_hash`.
- [ ] `runCommand` (tier 2) requires approval — unapproved call is refused.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/agent-runtime/src/code-mode/sandboxed-tools.ts` | Sandboxed tool executor |
| `packages/agent-runtime/src/code-mode/tiers.ts` | Tool-tier enforcement |
| `packages/agent-runtime/src/code-mode/rate-limiter.ts` | Per-tool rate limiting |
| `packages/db/migrations/0114_code_mode_sessions.sql` | Session/evidence table |
| `packages/agent-runtime/src/__tests__/sandboxed-tools.test.ts` | §3.6 matrix |

---

## 5. Acceptance Criteria

- [ ] `write_file` executes inside the sandbox (a test writes, then the sandboxed `read_file` sees it; the host side asserts the host fs is untouched).
- [ ] Tier-1 writes land only in the workspace mount; an out-of-workspace write fails.
- [ ] Tier-2 (`runCommand`) is refused without OPERATOR approval.
- [ ] Calling `write_file` more than `maxCallsPerTask` times → `ToolRateLimitError`, surfaced to the orchestrator.
- [ ] A code-mode session writes a `code_mode_sessions` row with populated `tool_calls` and a `workspace_content_hash` matching the bytes.
- [ ] `--network none` still holds for Code-Mode runs (shared runtime, not a separate exception).
- [ ] `pnpm --filter @harness/agent-runtime test` + `…sandbox test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **One sandbox, two consumers means one runtime to harden, patch, and audit.** Resist a second "code-mode sandbox". The attack surface doubles if verification and code mode fork; the invariants (`--network none`, read-only root, non-root, cap-drop) must live in exactly one place.
- **Tiers must be by *construction*, not by `if`.** An `if (tier < 2) deny()` in generated-code-reachable code is a soft boundary; read-only mounts and a single writable workspace are hard ones. Enforce both, but the mount is the security boundary — the `if` is a UX guard.
- **Rate limiting bounds the *attacker's loop*, not the victim's throughput.** The failure mode is a generated `while(true)` spinning up containers; `maxCallsPerTask` + `maxConcurrent` is what turns that from a resource exfiltration into a catchable error.
- **Arbitrary `runCommand` is a tier-2 superpower.** If it slips into tier 1, the whole tiering collapses into "read-only or arbitrary". The tier-2 gate (OPERATOR approval) is the ejector seat — test that the unlapproved path is refused (not just logged).
- **Session records are evidence, so they must be append-only.** `tool_calls` is a log of what happened; never rewrite it. A `code_mode_sessions` row that can be edited after the fact is provenance theater.
- **Next (Day 24):** promote Spec 8 (Human Review Interface) to a standalone spec — the review surface the OPERATOR-tier approvals above actually live in.

---

*Prev: [Day 22 — Container Sandbox for Verification](day-22.md) | Next: [Day 24 — Promote Spec 8](day-24.md)*