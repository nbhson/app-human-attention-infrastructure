import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DockerSandbox } from '../docker-sandbox.js';
import { SandboxInfraError } from '../errors.js';
import type { SandboxRun } from '../sandbox.js';

function makeRun(overrides: Partial<SandboxRun> = {}): SandboxRun {
  return {
    command: ['tsc', '--noEmit', '-p', '.'],
    image: 'harness-verify:node20',
    workdirPath: '/tmp/worktree',
    workdirContents: [{ path: 'src/index.ts', contentHash: 'deadbeef' }],
    limits: { cpu: '1.0', memory: '512m', timeoutSeconds: 60 },
    network: 'none',
    ...overrides,
  };
}

/** The fake `docker` executable: logs argv, then behaves per `FAKE_DOCKER_MODE`. */
const STUB = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const log = process.env.FAKE_DOCKER_LOG;
if (log) appendFileSync(log, JSON.stringify(argv) + '\\n');
if (argv[0] === 'rm') process.exit(0);
const mode = process.env.FAKE_DOCKER_MODE;
if (mode === 'exit0') { process.stdout.write('compile ok\\n'); process.exit(0); }
if (mode === 'exit3') { process.stderr.write('TS2322: boom\\n'); process.exit(3); }
if (mode === 'exit125') { process.stderr.write('Cannot connect to the Docker daemon\\n'); process.exit(125); }
if (mode === 'exit127-image') { process.stderr.write('docker: Error response from daemon: No such image: harness-verify:node20\\n'); process.exit(127); }
if (mode === 'exit127-program') { process.stderr.write("sh: ng: not found\\n"); process.exit(127); }
if (mode === 'exit1-daemon') { process.stderr.write('failed to connect to the docker API at unix:///Users/x/.docker/run/docker.sock; check if the path is correct and if the daemon is running\\n'); process.exit(1); }
if (mode === 'exit1-program') { process.stderr.write('TS2322: boom\\n'); process.exit(1); }
if (mode === 'hang') { setTimeout(() => process.exit(0), 2000); } else { process.exit(0); }
`;

function stubDocker(mode: string): { docker: string; log: string; sandbox: DockerSandbox } {
  const dir = mkdtempSync(join(tmpdir(), 'docker-sandbox-'));
  const docker = join(dir, 'docker');
  writeFileSync(docker, STUB);
  chmodSync(docker, '755');
  const log = join(dir, 'argv.log');
  process.env.FAKE_DOCKER_LOG = log;
  process.env.FAKE_DOCKER_MODE = mode;
  return { docker, log, sandbox: new DockerSandbox({ dockerBinary: docker }) };
}

function readArgs(log: string): string[][] {
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

describe('DockerSandbox.buildArgs (day-22 §2.2)', () => {
  it('sets every isolation flag — no egress, read-only, non-root, no capabilities, capped', () => {
    const sandbox = new DockerSandbox();
    const args = sandbox.buildArgs(makeRun(), 'harness-verify-test');

    expect(args).toEqual(expect.arrayContaining(['--network', 'none', '--read-only', '--user', '1000:1000']));
    expect(args).toEqual(expect.arrayContaining(['--cap-drop', 'ALL', '--cpus', '1.0', '--memory', '512m']));
    expect(args).toEqual(expect.arrayContaining(['--security-opt', 'no-new-privileges', '--pids-limit', '256']));
    expect(args).toEqual(expect.arrayContaining(['--tmpfs', '/tmp:rw,noexec,nosuid,size=64m']));
    expect(args).toEqual(expect.arrayContaining(['--rm']));
    // The workdir is mounted read-only at the expected path.
    expect(args).toContain('type=bind,src=/tmp/worktree,dst=/workdir,readonly');
    expect(args).toEqual(expect.arrayContaining(['--workdir', '/workdir', 'harness-verify:node20']));
    // The requested command is passed through after the image.
    expect(args.slice(args.indexOf('harness-verify:node20') + 1)).toEqual(['tsc', '--noEmit', '-p', '.']);
  });

  it('mounts /workdir writable only when workspaceWritable is set (day-23 §2.2)', () => {
    const sandbox = new DockerSandbox();
    const readOnly = sandbox.buildArgs(makeRun(), 'harness-verify-test');
    expect(readOnly).toContain('type=bind,src=/tmp/worktree,dst=/workdir,readonly');

    const writable = sandbox.buildArgs(makeRun({ workspaceWritable: true }), 'harness-verify-test');
    expect(writable).toContain('type=bind,src=/tmp/worktree,dst=/workdir');
    // The rootfs stays read-only even when the workspace is writable.
    expect(writable).toEqual(expect.arrayContaining(['--read-only']));
  });

  it('allows bridge network for the explicit deps-install step (build/test stay on none)', () => {
    const sandbox = new DockerSandbox();
    const args = sandbox.buildArgs(makeRun({ network: 'bridge' }), 'harness-verify-install');
    expect(args).toEqual(expect.arrayContaining(['--network', 'bridge']));
  });

  it('defaults /tmp tmpfs to 64m and allows a larger one for the install step', () => {
    const sandbox = new DockerSandbox();
    expect(sandbox.buildArgs(makeRun(), 'x')).toEqual(
      expect.arrayContaining(['--tmpfs', '/tmp:rw,noexec,nosuid,size=64m']),
    );
    expect(sandbox.buildArgs(makeRun({ tmpfsSize: '1g' }), 'x')).toEqual(
      expect.arrayContaining(['--tmpfs', '/tmp:rw,noexec,nosuid,size=1g']),
    );
  });

  it('fails closed on a malformed tmpfs size', () => {
    const sandbox = new DockerSandbox();
    expect(() => sandbox.buildArgs(makeRun({ tmpfsSize: 'huge' }), 'x')).toThrow(SandboxInfraError);
  });
});

describe('DockerSandbox.run (day-22 §3.2)', () => {
  it('passes through exit 0 with captured stdout', async () => {
    const { sandbox } = stubDocker('exit0');
    const result = await sandbox.run(makeRun());
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('compile ok');
  });

  it('passes through a non-zero exit and captured stderr', async () => {
    const { sandbox } = stubDocker('exit3');
    const result = await sandbox.run(makeRun());
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toContain('TS2322: boom');
  });

  it('tags a missing image / daemon error (125) as SandboxInfraError, not a check result', async () => {
    const { sandbox } = stubDocker('exit125');
    await expect(sandbox.run(makeRun())).rejects.toBeInstanceOf(SandboxInfraError);
  });

  it('tags a Docker image failure (127 + daemon message) as SandboxInfraError with the log tail', async () => {
    const { sandbox } = stubDocker('exit127-image');
    const error = await sandbox.run(makeRun()).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(SandboxInfraError);
    expect(String(error)).toContain('No such image');
  });

  it('passes through a program command-not-found (127 without docker message) as FAILED evidence, not infra', async () => {
    const { sandbox } = stubDocker('exit127-program');
    const result = await sandbox.run(makeRun());
    expect(result.exitCode).toBe(127);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toContain('ng: not found');
  });

  it('tags a daemon-down CLI failure (exit 1 + connection message) as SandboxInfraError', async () => {
    const { sandbox } = stubDocker('exit1-daemon');
    await expect(sandbox.run(makeRun())).rejects.toBeInstanceOf(SandboxInfraError);
  });

  it('still passes through a program exit 1 without a daemon message', async () => {
    const { sandbox } = stubDocker('exit1-program');
    const result = await sandbox.run(makeRun());
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it('reports timedOut and force-removes the container when the command hangs', async () => {
    const { log, sandbox } = stubDocker('hang');
    const result = await sandbox.run(makeRun({ limits: { cpu: '1.0', memory: '512m', timeoutSeconds: 0.2 } }));

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(137);
    expect(result.stderr).toContain('sandbox timed out after 0.2s');

    // The container was force-removed by name (not left orphaned) — day-26 §3.3.
    const args = readArgs(log);
    const rm = args.find((argv) => argv[0] === 'rm');
    expect(rm?.[1]).toBe('-f');
    expect(rm?.[2]).toMatch(/^harness-verify-/);
  });

  it('rejects with SandboxInfraError when the docker binary is missing', async () => {
    const sandbox = new DockerSandbox({ dockerBinary: '/nonexistent/docker' });
    await expect(sandbox.run(makeRun())).rejects.toBeInstanceOf(SandboxInfraError);
  });
});
