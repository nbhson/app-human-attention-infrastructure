import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DockerSandbox } from '../docker-sandbox.js';
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

/**
 * A fake `docker` that logs every verb (`run`/`rm`) with its `--name` and echoes
 * the container name + workdir mount to stdout on a run. The run verb hangs when
 * `FAKE_DOCKER_HANG=1`, so the harness timeout path (and its `rm -f`) fires.
 */
const STUB = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const argv = process.argv.slice(2);
let name = '?';
if (argv[0] === 'rm') {
  name = argv[2] ?? '?'; // rm -f <name>
} else {
  const i = argv.indexOf('--name');
  name = i === -1 ? '?' : argv[i + 1];
}
const log = process.env.FAKE_DOCKER_LOG;
if (log) appendFileSync(log, JSON.stringify({ verb: argv[0], name }) + '\\n');
if (argv[0] === 'rm') process.exit(0);
const mount = argv.find((a) => a.startsWith('type=bind')) ?? '';
process.stdout.write('NAME=' + name + ' MOUNT=' + mount + '\\n');
if (process.env.FAKE_DOCKER_HANG === '1') {
  setTimeout(() => process.exit(0), 3000);
} else {
  process.exit(0);
}
`;

function stubDocker(): { docker: string; log: string; sandbox: DockerSandbox } {
  const dir = mkdtempSync(join(tmpdir(), 'sandbox-harvest-'));
  const docker = join(dir, 'docker');
  writeFileSync(docker, STUB);
  chmodSync(docker, '755');
  const log = join(dir, 'argv.log');
  process.env.FAKE_DOCKER_LOG = log;
  return { docker, log, sandbox: new DockerSandbox({ dockerBinary: docker }) };
}

function parseLog(log: string): Array<{ verb: string; name: string }> {
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { verb: string; name: string });
}

/**
 * The `run` child writes its entry at Node cold-boot, which under full-suite
 * CPU contention can outrace the 0.2s sandbox timeout — a one-shot read would
 * race the tail and intermittently miss the `run` verb. Poll until both the
 * `run` entry and its `rm` harvest entry have landed.
 */
async function readLog(log: string): Promise<Array<{ verb: string; name: string }>> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const entries = parseLog(log);
    const hasRun = entries.some((entry) => entry.verb === 'run');
    const hasRm = entries.some((entry) => entry.verb === 'rm');
    if ((hasRun && hasRm) || Date.now() >= deadline) {
      return entries;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('DockerSandbox orphan harvest (day-26 §3.3)', () => {
  it('force-removes the exact timed-out container by name (no orphan)', async () => {
    const { log, sandbox } = stubDocker();
    process.env.FAKE_DOCKER_HANG = '1';

    const result = await sandbox.run(
      makeRun({ limits: { cpu: '1.0', memory: '512m', timeoutSeconds: 0.2 } }),
    );

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(137);

    const entries = await readLog(log);
    const run = entries.find((entry) => entry.verb === 'run');
    const rm = entries.find((entry) => entry.verb === 'rm');

    expect(run?.name).toMatch(/^harness-verify-/);
    // The harvest targets exactly the container this run created — not some other.
    expect(rm?.name).toBe(run?.name);
  });
});

describe('DockerSandbox parallel attribution (day-26 §3.4)', () => {
  it('attributes each concurrent result to its own container and workdir', async () => {
    const { sandbox } = stubDocker();
    delete process.env.FAKE_DOCKER_HANG;

    const runs = ['/tmp/wt-a', '/tmp/wt-b', '/tmp/wt-c'].map((workdirPath) =>
      makeRun({
        workdirPath,
        workdirContents: [{ path: 'src/index.ts', contentHash: workdirPath }],
      }),
    );

    const results = await Promise.all(runs.map((run) => sandbox.run(run)));

    const names = new Set<string>();
    results.forEach((result, i) => {
      const match = /NAME=([^\s]+) MOUNT=(type=bind,[^\s]+)/.exec(result.stdout);
      expect(match, `run ${i}`).not.toBeNull();
      // The regex always yields both captures once matched.
      const name = match![1]!;
      const mount = match![2]!;
      names.add(name);
      // The result's workdir is its own, not a neighbor's — no cross-contamination.
      expect(mount).toContain(runs[i]!.workdirPath);
    });

    // Every run spawned (and was attributed to) a distinct container.
    expect(names.size).toBe(runs.length);
  });
});
