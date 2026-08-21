import { describe, expect, it } from 'vitest';

import { sanitizedEnv, truncateOutput } from '../env.js';

describe('sanitizedEnv', () => {
  it('strips secret/blocked keys but preserves PATH/PWD/NODE_ENV', () => {
    const env = sanitizedEnv({
      PATH: '/usr/bin:/bin',
      PWD: '/work',
      HOME: '/root',
      NODE_ENV: 'test',
      npm_config_user_agent: 'pnpm',
      ANTHROPIC_API_KEY: 'sk-ant-123456',
      DATABASE_URL: 'postgres://u:p@localhost/db',
      DATABASE_URL_UNPOOLED: 'postgres://u:p@localhost/db',
      GITHUB_TOKEN: 'ghp_123',
      SOME_SECRET: 'abc',
      FOO: 'bar',
    });

    // Hands-off keys survive untouched.
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.PWD).toBe('/work');
    expect(env.HOME).toBe('/root');
    expect(env.NODE_ENV).toBe('test');
    expect(env.npm_config_user_agent).toBe('pnpm');
    expect(env.FOO).toBe('bar');

    // Credentials never reach a spawned check process.
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.DATABASE_URL_UNPOOLED).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.SOME_SECRET).toBeUndefined();
  });

  it('drops undefined-valued keys', () => {
    const env = sanitizedEnv({ PATH: '/usr/bin', UNUSED: undefined });
    expect(Object.keys(env)).toContain('PATH');
    expect(Object.keys(env)).not.toContain('UNUSED');
  });
});

describe('truncateOutput', () => {
  it('returns short output unchanged', () => {
    expect(truncateOutput('hi')).toBe('hi');
  });

  it('caps long output and marks the cut tail', () => {
    const out = truncateOutput('a'.repeat(1000), 64);
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out.endsWith('...[truncated]')).toBe(true);
  });
});
