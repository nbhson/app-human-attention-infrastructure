/**
 * Pinned-image assurance (day-22 §3.2): build `harness-verify:node20` from the
 * committed {@link ../Dockerfile} when it is not already present.
 *
 * The runtime sandbox itself does *not* build on every run (that would put a
 * network-bound `docker build` in the hot path); it relies on the infra-exit-code
 * discriminator in `docker-sandbox.ts` to fall back when the image is missing.
 * Operators pre-build the image once via `ensureImage`, or the engine falls back
 * with a logged warning.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { SandboxInfraError } from './errors.js';

const DOCKERFILE = fileURLToPath(new URL('../Dockerfile', import.meta.url));
const BUILD_CONTEXT = fileURLToPath(new URL('..', import.meta.url));

interface DockerOutcome {
  readonly code: number | null;
  readonly output: string;
}

function runDocker(binary: string, args: string[]): Promise<DockerOutcome> {
  return new Promise((resolve) => {
    const proc = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', () => resolve({ code: null, output }));
    proc.on('close', (code) => resolve({ code, output }));
  });
}

/**
 * Build `image` from the committed Dockerfile if it does not already exist.
 * Throws {@link SandboxInfraError} when the daemon is down or the build fails.
 */
export async function ensureImage(image: string, dockerBinary = 'docker'): Promise<void> {
  const inspect = await runDocker(dockerBinary, ['image', 'inspect', image]);
  if (inspect.code === 0) {
    return;
  }
  const build = await runDocker(dockerBinary, ['build', '-t', image, '-f', DOCKERFILE, BUILD_CONTEXT]);
  if (build.code !== 0) {
    throw new SandboxInfraError(`failed to build ${image}: ${build.output}`);
  }
}
