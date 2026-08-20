# Day 22 — Container Sandbox for Verification (Spec 7 §5.5)

| | |
|---|---|
| **Week** | 5 — Sandbox, object store, Spec 8 |
| **Spec refs** | Spec 7 §5.5 (isolated execution environment), §5.6 (flaky handling), §5.7 (timeouts); Spec 9 §3.2 (tamper-evident evidence) |
| **Estimated effort** | 8 hours |
| **Prerequisites** | Day 21 (object store); Phase-1 in-process verification (worktree + `sanitizedEnv`, output cap 64 KB) |

---

## 1. Objectives

By end of day you will have:

1. A new **`packages/sandbox`** exposing a `Sandbox` interface and a **container runtime** (Docker) that runs verification checks in an isolated, reproducible container — replacing the Phase-1 in-process `tsc`/`vitest` execution.
2. A **minimal, explicit tool surface** — the container runs *one command and reads output*, nothing more (Spec 7 §5.5's "minimal benchmark harness" principle): no network egress, read-only rootfs, a single writable output dir, enforced resource limits.
3. **Attributability** — a verification result is only meaningful when the exact content verified is identified by `content_hash` and recorded in the `VerificationResult` (Spec 7 §5.5's rule), so a sandbox result links to the bytes it verified.
4. **Parity guarantee** — the sandboxed `COMPILE`/`TEST` results agree with the Phase-1 in-process results on the same fixture (the swap must not silently change verdicts).

The independence that matters (verification ≠ generation) becomes *structural* today: verification no longer shares a process with the agent that generated the change.

---

## 2. Design Decisions

### 2.1 `Sandbox` interface — one abstraction, two consumers (this + Day 23)

```typescript
// packages/sandbox/src/sandbox.ts
export interface SandboxRun {
  command: string[];                 // ["bash", "-lc", "npx tsc --noEmit"]
  image: string;                     // pinned, e.g. "harness-verify:node20"
  workdirContents: { path: string; contentHash: string }[];  // exact bytes being verified
  limits: { cpu: string; memory: string; timeoutSeconds: number };
  network: 'none';                    // non-negotiable
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;                     // capped (reuse Phase-1 64 KB cap)
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}
```

Spec 7 §5.5 and Spec 3 §14.3 explicitly share one sandbox abstraction so verification is *genuinely independent of generation* — not just a different call site. The interface is defined once, here.

### 2.2 Hard isolation, no egress, read-only root

The container runs with:

```text
--network none          # cannot phone out / exfiltrate
--read-only             # rootfs read-only; only the declared output dir is writable
--memory + --cpus       # per Spec 7 §5.7's resource/timeout discipline
--user 1000:1000        # non-root
--cap-drop ALL          # no capabilities
```

Mount the change's worktree contents read-only (the exact bytes, matched by `content_hash`); mount a scratch dir read-write as the only writable surface. The check's output is captured (capped 64 KB) and returned; the container is destroyed after the run.

### 2.3 Determinism + the image is pinned

The image `harness-verify:node20` is built from a committed `Dockerfile` (lockfile-pinned Node + tsc + vitest versions). A verification result is only reproducible if the tool versions are locked — "latest" in a verification image is a reproducibility bug (Spec 7 §5.5's "locked tool versions").

### 2.4 Fallback + parity gate

Until sandbox parity is proven, the verification engine runs **both** in-process and sandboxed on a subset and compares; full cutover happens when parity holds (acceptance below). Any sandbox infra failure (Daemon down, image missing) routes to the Phase-1 in-process path with a logged warning — verification must degrade, not die, on sandbox trouble (mirrors Day-13's bounded-degradation discipline).

---

## 3. Tasks

### 3.1 Scaffold `packages/sandbox` + interface (45 min)

- [ ] `package.json` (`@harness/sandbox`); `src/sandbox.ts` (§2.1); `src/errors.ts` (`SandboxInfraError`, `SandboxTimeoutError`).

### 3.2 Container runtime (150 min)

- [ ] `src/docker-runtime.ts` — `run(SandboxRun): Promise<SandboxResult>` using the Docker API; enforce §2.2's flags; capture + cap stdout/stderr; enforce timeout (kill on expiry).
- [ ] `src/image.ts` — ensure/build the pinned image.

### 3.3 Wire into verification engine (120 min)

- [ ] `packages/verification-engine/src/executors/sandboxed-executor.ts` — build a `SandboxRun` per check (compile/test), run in sandbox, map `SandboxResult` → `VerificationCheckResult`.
- [ ] Record `content_hash` of the verified worktree in the `VerificationResult` (attributability).
- [ ] Register `TOKENS.Sandbox` + resolve in the engine; `docs/architecture/wiring-map.md`.

### 3.4 Parity + fallback (90 min)

- [ ] Dual-run a fixture (in-process vs sandbox) and assert identical PASS/FAIL verdicts.
- [ ] Fallback: sandbox down → in-process path with a logged warning (test injects a failing `Sandbox`).

### 3.5 Tests (75 min)

- [ ] A sandboxed `tsc` on good code → exit 0; on a type error → exit non-zero with `stderr` captured.
- [ ] Timeout: a `sleep` command longer than the limit → `timedOut: true`.
- [ ] Network: a command attempting `curl` fails (network=none asserted).
- [ ] Read-only: a command writing outside the output dir fails.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/sandbox/src/{sandbox,errors}.ts` | Sandbox interface + errors |
| `packages/sandbox/src/docker-runtime.ts` | Container runtime |
| `packages/sandbox/src/image.ts` + `Dockerfile` | Pinned verify image |
| `packages/verification-engine/src/executors/sandboxed-executor.ts` | Sandboxed check executor |
| `packages/sandbox/src/__tests__/sandbox.test.ts` | §3.5 matrix |

---

## 5. Acceptance Criteria

- [ ] A sandboxed `COMPILE` check returns exit 0 on clean code and non-zero (with `stderr`) on a type error.
- [ ] `timedOut: true` when a check exceeds its limit; the container is killed, not orphaned.
- [ ] `--network none` holds: an attempted outbound call fails inside the sandbox.
- [ ] A write outside the declared output dir fails (read-only rootfs).
- [ ] Parity: sandboxed vs in-process verdicts agree on the same fixture (test asserts equality).
- [ ] `VerificationResult` records the `content_hash` of the verified bytes (attributability).
- [ ] Fallback: injected sandbox failure routes to in-process with a logged warning, not a crash.
- [ ] `pnpm --filter @harness/sandbox test` + `…verification-engine test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **A sandbox you can `docker run` from outside isn't the sandbox you think.** The flags (`--network none`, `--read-only`, `--cap-drop ALL`, non-root) are the *whole* security property — one omitted flag and you've shipped a VM, not a sandbox. Test each flag's effect, not just its presence.
- **Image pinning is a correctness matter, not a hygiene matter.** `latest` tools mean a re-run changes the verdict without touching a line of code — the reproducibility-killer. The image is built from a committed Dockerfile with lockfile-pinned versions.
- **Attributability ≠ "it ran in a sandbox".** A result matters only when the exact bytes it verified are identified by `content_hash` (Spec 7 §5.5). Without it, a sandboxed PASS proves nothing about the change under review.
- **Network-none breaks legitimate-but-unneeded steps.** Some test setups "phone home" (npm audit, telemetry). Those must be disabled in the image, not by allowing egress. Allow `--network none` and fix the image; never the reverse.
- **Fallback is deliberate degradation, and it must be loud.** If the sandbox dies and verification silently falls back forever, you've quietly reverted to Phase-1 isolation. Log + alert (Spec 10) on fallback rate.
- **Next (Day 23):** the same sandbox abstraction for agent Code Mode (Spec 3 §14.3) — batched tool calls in the container, not the host process.

---

*Prev: [Day 21 — Object Store: S3/MinIO `ContentStore` for Large Artifacts](day-21.md) | Next: [Day 23 — Container Sandbox for Agent Code Mode (Spec 3 §14.3)](day-23.md)*
