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
  /** The command line to run inside the container, e.g. `['sh', '-lc', 'tsc …']` (alpine has no `bash`). */
  readonly command: string[];
  /** The pinned image (built from a committed Dockerfile, never `latest`). */
  readonly image: string;
  /** Host directory mounted at `/workdir` — the exact bytes verified. */
  readonly workdirPath: string;
  /** Per-file manifest of the workdir, for attributability. */
  readonly workdirContents: SandboxWorkdirFile[];
  /** Resource + time budgets. */
  readonly limits: SandboxLimits;
  /**
   * The container network. `'none'` (default, no egress) is the safe mode for
   * running untrusted code. `'bridge'` is reserved for the dependency-install
   * step (`<pm> ci` needs the registry) — build/test always stay on `'none'`
   * so installed code never gets egress.
   */
  readonly network: 'none' | 'bridge';
  /**
   * Size of the writable `/tmp` tmpfs (e.g. `'64m'`, `'1g'`). Default `'64m`.
   * The dependency-install step needs far more (a cold npm cache for a large
   * app is hundreds of MB — with 64m `npm ci` dies `ENOSPC`); build/test use
   * `512m` (Angular-class `ng build` spills compiler temp + npm cache there
   * and stalls in "setup" on a full /tmp instead of failing loudly).
   */
  readonly tmpfsSize?: string;
  /**
   * Whether `/workdir` is mounted writable (day-23 §2.2). Default `false` —
   * read-only — which verification (Day 22) and Code-Mode tier 0 rely on.
   * Code-Mode tier 1 sets `true` so `write_file` lands in the workspace mount;
   * the container rootfs stays `--read-only` either way, so the only writable
   * path is the workspace mount itself.
   */
  readonly workspaceWritable?: boolean;
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
