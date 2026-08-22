import { describe, expect, it } from 'vitest';

import { DockerSandbox, SandboxInfraError, SandboxTimeoutError } from './index.js';

describe('@harness/sandbox', () => {
  it('exports the public surface', () => {
    expect(typeof DockerSandbox).toBe('function');
    expect(typeof SandboxInfraError).toBe('function');
    expect(typeof SandboxTimeoutError).toBe('function');
    const timeout = new SandboxTimeoutError(60);
    expect(timeout.name).toBe('SandboxTimeoutError');
    expect(timeout.timeoutSeconds).toBe(60);
  });
});
