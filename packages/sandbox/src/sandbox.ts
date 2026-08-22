/**
 * `@harness/sandbox` — the shared isolated-execution seam (day-22 §2.1).
 *
 * One {@link Sandbox} abstraction serves both consumers: verification (Day 22)
 * and agent Code Mode (Day 23, Spec 3 §14.3). A `Sandbox` runs a single command
 * in an isolated, reproducible container — no network, read-only rootfs,
 * non-root user, dropped capabilities — and returns only the exit code plus
 * capped output. Nothing more: the sandbox is a minimal benchmark harness, not
 * a VM.
 *
 * The exact bytes the sandbox verified are identified by a per-file manifest
 * (`workdirContents`) and an aggregate `content_hash`, so a result is only
 * meaningful when it can be attributed to the content it actually verified
 * (Spec 7 §5.5).
 */

/** A file in the workdir being verified, with its SHA-256 identity. */
export interface SandboxWorkdirFile {
  /** Path relative to the workdir root, e.g. `src/index.ts`. */
  readonly path: string;
  /** SHA-256 (hex) of the file bytes. */
  readonly contentHash: string;
}

/** Per-run resource + time budget (Spec 7 §5.7). */
export interface SandboxLimits {
  /** CPU quota, e.g. `'1.0'` (one core). */
  readonly cpu: string;
  /** Memory quota, e.g. `'512m'`. */
  readonly memory: string;
  /** Wall-clock budget in seconds; the container is killed on expiry. */
  readonly timeoutSeconds: number;
}

/** A single sandbox execution request (day-22 §2.1). */
export interface SandboxRun {
  /** The command line to run inside the container, e.g. `['bash', '-lc', 'tsc …']`. */
  readonly command: string[];
  /** The pinned image (built from a committed Dockerfile, never `latest`). */
  readonly image: string;
  /** Host directory mounted read-only at `/workdir` — the exact bytes verified. */
  readonly workdirPath: string;
  /** Per-file manifest of the workdir, for attributability. */
  readonly workdirContents: SandboxWorkdirFile[];
  /** Resource + time budgets. */
  readonly limits: SandboxLimits;
  /** Always `'none'` — the sandbox has no egress. */
  readonly network: 'none';
}

/** The measured outcome of a sandbox run (day-22 §2.1). */
export interface SandboxResult {
  /** Process exit code; `137` when the container was killed (timeout / OOM). */
  readonly exitCode: number;
  /** Capped stdout (64 KB). */
  readonly stdout: string;
  /** Capped stderr (64 KB). */
  readonly stderr: string;
  /** True when the container was killed for exceeding `limits.timeoutSeconds`. */
  readonly timedOut: boolean;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
}

/** Runs a single {@link SandboxRun} in isolation and reports the outcome. */
export interface Sandbox {
  run(run: SandboxRun): Promise<SandboxResult>;
}
