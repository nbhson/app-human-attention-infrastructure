import { describe, expect, it } from 'vitest';

import { credentialEnvValues, redactSensitive } from '../redact.js';

describe('redactSensitive', () => {
  it('masks Authorization/Bearer/Basic header secrets', () => {
    const out = redactSensitive('Authorization: Bearer abc.def.ghi then Basic dXNlcjpwYXNz');

    expect(out).not.toContain('abc.def.ghi');
    expect(out).not.toContain('dXNlcjpwYXNz');
    expect(out).toContain('[redacted]');
  });

  it('masks token/key/value and provider-token shapes while leaving plain text', () => {
    const out = redactSensitive(
      'token=secrettoken api_key: anothersecret ghp_abcdefghijklmnop xoxb-1234567890-abcdef AKIAIOSFODNN7EXAMPLE clean text survives',
    );

    expect(out).not.toContain('secrettoken');
    expect(out).not.toContain('anothersecret');
    expect(out).not.toContain('abcdefghijklmnop');
    expect(out).not.toContain('1234567890');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('[redacted]');
    expect(out).toContain('clean text survives');
  });

  it('scrubs explicit secret strings by their literal bytes', () => {
    const out = redactSensitive('the key is hunter42 everywhere', ['hunter42']);
    expect(out).not.toContain('hunter42');
    expect(out).toContain('the key is [redacted] everywhere');
  });
});

describe('credentialEnvValues', () => {
  it('collects only env values that look like credentials', () => {
    const values = credentialEnvValues({
      GITHUB_TOKEN: 'ghp_real',
      API_KEY: 'sk-abc123',
      USER: 'short', // too short
      NODE_ENV: 'test',
      SESSION_SECRET: 'supersecretvalue',
      PLAIN: 'plainvalue',
    });

    expect(values).toContain('ghp_real');
    expect(values).toContain('sk-abc123');
    expect(values).toContain('supersecretvalue');
    expect(values).not.toContain('short');
    expect(values).not.toContain('test');
    expect(values).not.toContain('plainvalue');
  });
});
