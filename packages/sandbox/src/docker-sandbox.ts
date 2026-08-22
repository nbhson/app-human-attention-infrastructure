/**
 * Docker-backed {@link Sandbox} (day-22 §2.2) — the real isolation runtime.
 *
 * The security property lives *entirely* in the `docker run` flags: `--network
 * none` (no egress), `--read-only` (rootfs immutable), `--cap-drop ALL` +
 * `--user 1000:1000` (non-root, no capabilities), plus `--cpus`/`--memory`
 * (resource caps). One missing flag and it's a VM, not a sandbox (§6), so
 * `buildArgs` is pure and public — tests assert every flag's presence without
 * needing a daemon.
 *
 * Docker reserves exit codes 125 ("daemon error"), 126 ("command cannot
 * execute") and 127 ("command not found") for *its own* failures — an image
 * that does not exist lands here, not in a program result. Those are surfaced
 * as {@link SandboxInfraError} so the engine falls back to in-process
 * verification rather than recording a false `FAILED` (§2.4). Program results
 * (1–124, 128+) are passed through verbatim.
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

/** Docker-level failure exit codes (not program results). */
const DOCKER_INFRA_EXIT_CODES = new Set([125, 126, 127]);

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
      '--cpus',
      run.limits.cpu,
      '--memory',
      run.limits.memory,
      '--mount',
      `type=bind,src=${run.workdirPath},dst=/workdir,readonly`,
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

      const timer = setTimeout(() => {
        // A SIGKILLed `docker run` parent leaves the container orphaned; kill it
        // by name (the `--rm` flag then reclaims it) before reporting timeout.
        void this.killContainer(containerName).finally(() => {
          finish({
            exitCode: 137,
            stdout: cap(stdout),
            stderr: cap(`${stderr}\n...[sandbox timed out after ${run.limits.timeoutSeconds}s]`),
            timedOut: true,
            durationMs: Date.now() - started,
          });
        });
      }, run.limits.timeoutSeconds * 1000);

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
        if (DOCKER_INFRA_EXIT_CODES.has(code ?? -1)) {
          reject(new SandboxInfraError(`docker run failed with exit ${code}`));
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

  private killContainer(name: string): Promise<void> {
    return new Promise((resolve) => {
      let proc: ChildProcess;
      try {
        proc = spawn(this.docker, ['kill', name], { stdio: 'ignore' });
      } catch {
        resolve();
        return;
      }
      proc.on('error', () => resolve());
      proc.on('close', () => resolve());
    });
  }
}
