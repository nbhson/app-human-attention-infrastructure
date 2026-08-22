import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ensureImage } from '../image.js';
import { SandboxInfraError } from '../errors.js';

/** A fake `docker` that decides based on its first arg (`inspect` vs `build`). */
const STUB = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const argv = process.argv.slice(2);
if (process.env.FAKE_DOCKER_LOG) appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(argv) + '\\n');
if (argv[0] === 'image' && argv[1] === 'inspect') {
  process.exit(process.env.FAKE_INSPECT_EXIT === '0' ? 0 : 1);
}
if (argv[0] === 'build') {
  process.exit(process.env.FAKE_BUILD_EXIT === '0' ? 0 : 1);
}
process.exit(0);
`;

function stubDocker(): { docker: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sandbox-image-'));
  const docker = join(dir, 'docker');
  writeFileSync(docker, STUB);
  chmodSync(docker, '755');
  const log = join(dir, 'argv.log');
  process.env.FAKE_DOCKER_LOG = log;
  process.env.FAKE_INSPECT_EXIT = '1';
  process.env.FAKE_BUILD_EXIT = '0';
  return { docker, log };
}

describe('ensureImage (day-22 §3.2)', () => {
  it('builds the pinned image when it is absent', async () => {
    const { docker, log } = stubDocker();
    await ensureImage('harness-verify:node20', docker);

    const args = readArgs(log);
    expect(args.some((argv) => argv[0] === 'image' && argv[1] === 'inspect')).toBe(true);
    const build = args.find((argv) => argv[0] === 'build');
    expect(build).toContain('harness-verify:node20');
  });

  it('skips the build when the image already exists', async () => {
    const { docker, log } = stubDocker();
    process.env.FAKE_INSPECT_EXIT = '0';
    await ensureImage('harness-verify:node20', docker);

    const args = readArgs(log);
    expect(args.some((argv) => argv[0] === 'build')).toBe(false);
  });

  it('throws SandboxInfraError when the build fails', async () => {
    const { docker } = stubDocker();
    process.env.FAKE_BUILD_EXIT = '1';
    await expect(ensureImage('harness-verify:node20', docker)).rejects.toBeInstanceOf(
      SandboxInfraError,
    );
  });
});

function readArgs(log: string): string[][] {
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}
