/**
 * Docker-backed {@link Sandbox} (day-22 §2.2) — the real isolation runtime.
 *
 * The security property lives *entirely* in the `docker run` flags: `--network
 * none` (no egress), `--read-only` (rootfs immutable), `--cap-drop ALL` +
 * `--user 1000:1000` (non-root, no capabilities), `--security-opt
 * no-new-privileges` (no setuid escalation), `--pids-limit 256` (fork-bomb
 * cap), `--tmpfs /tmp` (writable scratch without touching the read-only
 * rootfs), plus `--cpus`/`--memory`
 * (resource caps). One missing flag and it's a VM, not a sandbox (§6), so
 * `buildArgs` is pure and public — tests assert every flag's presence without
 * needing a daemon.
 *
 * Docker reserves exit codes 125 ("daemon error"), 126 ("command cannot
 * execute") and 127 ("command not found") for *its own* failures — an image
 * that does not exist lands here, not in a program result. 125/126 are always
 * infra (a program almost never exits with them). 127 is ambiguous: the
 * program inside the container also exits 127 on "command not found"
 * (`sh: ng: not found`, missing `node_modules/.bin`), so it is only treated
 * as {@link SandboxInfraError} when the output carries a Docker image/pull
 * message — otherwise it passes through as the program's own FAILED result
 * (§2.4). Program results (1–124, 127-without-docker-message, 128+) are
 * passed through verbatim, and infra rejects always carry the container log
 * tail so a SKIPPED row is debuggable instead of a bare "exit 127".
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { SandboxInfraError } from './errors.js';
import type { Sandbox, SandboxResult, SandboxRun } from './sandbox.js';

/** Per-stream output cap (reused from Phase-1 §5.5). */
const OUTPUT_CAP = 64 * 1024;

function cap(output: string): string {
  if (output.length <= OUTPUT_CAP) {
    return output;
  }
  const marker = '\n...[truncated]';
  return output.slice(0, OUTPUT_CAP - marker.length) + marker;
}

/** Docker-level failure exit codes that are never program results. */
const DOCKER_HARD_INFRA_EXIT_CODES = new Set([125, 126]);

/**
 * 127 is shared between Docker ("image not found") and the program inside the
 * container ("command not found"). Only treat it as infra when the output
 * proves Docker itself failed — otherwise `sh: ng: not found` (missing
 * toolchain / uninstalled `node_modules`) would SKIP instead of FAIL.
 */
const DOCKER_IMAGE_ERROR_PATTERN =
  /docker:\s*error response|no such image|unable to find image|image .* not found|manifest .* not found|pull access denied|repository .* not found|does not exist or no pull access/i;

/**
 * Docker Desktop / CLI daemon-connection failures exit 1 (not 125) with a
 * connection message on stderr, e.g. `failed to connect to the docker API at
 * unix://...docker.sock` or `Cannot connect to the Docker daemon`. Without
 * this discriminator a down daemon would be recorded as a check `FAILED`
 * instead of a {@link SandboxInfraError} (fallback / SKIPPED).
 */
const DOCKER_DAEMON_DOWN_PATTERN =
  /cannot connect to the docker daemon|failed to connect to the docker api|is the docker daemon running|docker daemon is not running|dial unix.*docker\.sock|no such file or directory.*docker\.sock/i;

export interface DockerSandboxOptions {
  /** Override the `docker` binary path (tests inject a stub). */
  readonly dockerBinary?: string;
}

export class DockerSandbox implements Sandbox {
  private readonly docker: string;

  constructor(private readonly options: DockerSandboxOptions = {}) {
    this.docker = options.dockerBinary ?? 'docker';
  }

  /**
   * The `docker run` argv for `run`, exposed so tests can assert the isolation
   * flags without a daemon (§6: test each flag, not just its presence).
   */
  buildArgs(run: SandboxRun, containerName: string): string[] {
    // Defense-in-depth: the network is a closed union (`'none' | 'bridge'`),
    // so anything else fails closed here. `'bridge'` is only ever requested
    // by the explicit dependency-install step — build/test always pass
    // `'none'` so untrusted code never gets egress.
    if (run.network !== 'none' && run.network !== 'bridge') {
      throw new SandboxInfraError(`refusing to run sandbox with network "${run.network}" (must be "none" or "bridge")`);
    }
    // The tmpfs size is operator input (install needs ~1g for a cold package
    // cache, build/test keep 64m) — accept only `<digits>m|g`, fail closed
    // otherwise so a malformed limit cannot reach the docker CLI.
    const tmpfsSize = run.tmpfsSize ?? '64m';
    if (!/^\d+[mMgG]$/.test(tmpfsSize)) {
      throw new SandboxInfraError(`refusing to run sandbox with tmpfs size "${tmpfsSize}" (must match <digits>m|g)`);
    }
    return [
      'run',
      '--rm',
      '--name',
      containerName,
      '--network',
      run.network,
      '--read-only',
      '--user',
      '1000:1000',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      '256',
      '--tmpfs',
      `/tmp:rw,noexec,nosuid,size=${tmpfsSize}`,
      '--cpus',
      run.limits.cpu,
      '--memory',
      run.limits.memory,
      '--mount',
      run.workspaceWritable === true
        ? `type=bind,src=${run.workdirPath},dst=/workdir`
        : `type=bind,src=${run.workdirPath},dst=/workdir,readonly`,
      '--workdir',
      '/workdir',
      run.image,
      ...run.command,
    ];
  }

  async run(run: SandboxRun): Promise<SandboxResult> {
    const containerName = `harness-verify-${randomUUID()}`;
    const args = this.buildArgs(run, containerName);
    const started = Date.now();

    return new Promise<SandboxResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (result: SandboxResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      const proc: ChildProcess = spawn(this.docker, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      // Guard a malformed limit (NaN/0/negative from env parsing) — fall back
      // to 600s instead of a 1ms `setTimeout` or a never-firing timer that
      // would leave the verification stuck at RUNNING.
      const timeoutSeconds =
        Number.isFinite(run.limits.timeoutSeconds) && run.limits.timeoutSeconds > 0 ? run.limits.timeoutSeconds : 600;
      const timer = setTimeout(() => {
        // A SIGKILLed `docker run` parent leaves the container orphaned; force-
        // remove it by name (day-26 §3.3 — `rm -f` both kills and reclaims, so
        // the `--rm` reaper's job is done even if the parent died first).
        void this.harvestContainer(containerName).finally(() => {
          finish({
            exitCode: 137,
            stdout: cap(stdout),
            stderr: cap(`${stderr}\n...[sandbox timed out after ${timeoutSeconds}s]`),
            timedOut: true,
            durationMs: Date.now() - started,
          });
        });
      }, timeoutSeconds * 1000);

      proc.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        // ENOENT (docker missing) or the daemon refusing the socket.
        reject(new SandboxInfraError(`docker run failed: ${String(error)}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        const combined = `${stdout}\n${stderr}`;
        if (DOCKER_HARD_INFRA_EXIT_CODES.has(code ?? -1)) {
          reject(new SandboxInfraError(`docker run failed with exit ${code}: ${cap(stderr).slice(0, 500)}`));
          return;
        }
        // 127 discrimination: Docker's own image/pull failure → infra;
        // the program's "command not found" (missing toolchain or
        // node_modules/.bin) → a real result so the caller records FAILED
        // with evidence instead of a blind SKIPPED.
        if ((code ?? -1) === 127 && DOCKER_IMAGE_ERROR_PATTERN.test(combined)) {
          reject(new SandboxInfraError(`docker image unavailable (exit 127): ${cap(stderr).slice(0, 500)}`));
          return;
        }
        // Daemon-down via the CLI surfaces as exit 1 + a connection message
        // (not 125) — route it to infra so callers fall back instead of
        // recording a false FAILED.
        if ((code ?? 0) !== 0 && DOCKER_DAEMON_DOWN_PATTERN.test(`${stdout}\n${stderr}`)) {
          reject(new SandboxInfraError(`docker daemon unavailable (exit ${code}): ${cap(stderr).slice(0, 300)}`));
          return;
        }
        finish({
          exitCode: code ?? 137,
          stdout: cap(stdout),
          stderr: cap(stderr),
          timedOut: false,
          durationMs: Date.now() - started,
        });
      });
    });
  }

  /**
   * Harvest a possibly-orphaned container by name (day-26 §3.3). `docker rm -f`
   * force-stops and removes in one verb, so it is the single defensive step that
   * covers the timeout path (and any future exit path) without relying on the
   * parent `docker run` staying alive to honor `--rm`. Best-effort: a missing
   * container or a down daemon resolves silently.
   */
  private harvestContainer(name: string): Promise<void> {
    return new Promise((resolve) => {
      let proc: ChildProcess;
      try {
        proc = spawn(this.docker, ['rm', '-f', name], { stdio: 'ignore' });
      } catch {
        resolve();
        return;
      }
      proc.on('error', () => resolve());
      proc.on('close', () => resolve());
    });
  }
}
