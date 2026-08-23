# @harness/sandbox — Isolated Execution Seam

The container-sandbox seam shared by verification and agent Code Mode — isolates
untrusted or tooling-heavy execution so it never runs on the harness's own
process or filesystem.

**Status:** Phase 2 (Day 22–23) complete (as-built) ·
**Boundary rule:** shared package — imports only shared infrastructure; consumers resolve the `Sandbox` token, never the concrete backend.

---

## Purpose

1. **Define the `Sandbox` seam** — the contract both verification and code mode build on.
2. **Provide a Docker-backed implementation** — the real isolation boundary.
3. **Map workdirs** — a manifest controls what enters and leaves the sandbox.
4. **Select images** — pin the tooling image for a check or a code-mode run.
5. **Fail loudly** — timeouts and launch/exit failures are typed, not swallowed.

---

## Model

```text
   verification-engine ─┐
                        ├──▶ TOKENS.Sandbox (the seam) ──▶ DockerSandbox
   agent-runtime        ─┘                                 (container)
   (code mode)                                        ┌──────┴──────┐
                                                      ▼             ▼
                                              workdir-manifest   image.ts
                                              (input/output)    (which image)
```

Consumers stay runtime-agnostic: `verification-engine` resolves `TOKENS.Sandbox`
for `SandboxedCheck`, agent code mode for `SandboxedToolExecutor` — neither
imports the concrete `DockerSandbox`.

---

## Modules

| Module | What it provides |
| --- | --- |
| `sandbox.ts` | The `Sandbox` interface / contract. |
| `docker-sandbox.ts` | Docker-backed implementation. |
| `workdir-manifest.ts` | Input-output workdir/manifest mapping. |
| `image.ts` | Sandbox image selection. |
| `errors.ts` | Sandbox error types (timeouts, launch/exit failures). |

---

## Key invariants

- **Isolation is the point.** A sandboxed check cannot touch the host process or
  leak secrets; it gets a clean env and a bounded workdir.
- **One shared boundary.** Verification and code mode use the *same* sandbox
  abstraction, so verification is genuinely independent of generation, not just
  a different call site.

---

## Directory structure

```
src/
├── index.ts
├── sandbox.ts
├── docker-sandbox.ts
├── workdir-manifest.ts
├── image.ts
└── errors.ts
```

## Public API surface

```typescript
// Sandbox, DockerSandbox, WorkdirManifest, image selection, sandbox errors
```

## Wiring

Registered in `apps/api/src/bootstrap.ts` under `TOKENS.Sandbox`.