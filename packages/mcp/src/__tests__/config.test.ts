import { describe, expect, it } from 'vitest';

import { loadMcpConfig, McpConfigError, parseMcpConfig, redactToken } from '../config.js';

const FULL = JSON.stringify({
  servers: {
    github: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@github/mcp-server'],
      tokenEnv: 'GITHUB_TOKEN',
    },
    jira: { transport: 'sse', url: 'https://mcp.atlassian.com/sse', tokenEnv: 'JIRA_TOKEN' },
  },
});

const ENV = { GITHUB_TOKEN: 'gh_1234567890abcdef', JIRA_TOKEN: 'jira-secret-token' };

describe('redactToken', () => {
  it('keeps only the last 4', () => {
    expect(redactToken('gh_1234567890abcdef')).toBe('cdef');
  });

  it('masks a short secret entirely', () => {
    expect(redactToken('abc')).toBe('••••');
  });

  it('returns empty for empty', () => {
    expect(redactToken('')).toBe('');
  });
});

describe('parseMcpConfig', () => {
  it('parses a valid file to entries with token hints, never the value', () => {
    const config = parseMcpConfig(FULL, ENV);
    expect(config.servers.map((s) => s.name)).toEqual(['github', 'jira']);

    const github = config.servers[0]!;
    expect(github.transport).toBe('stdio');
    expect(github.command).toBe('npx');
    expect(github.tokenEnv).toBe('GITHUB_TOKEN');
    expect(github.tokenHint).toBe('cdef');

    const jira = config.servers[1]!;
    expect(jira.transport).toBe('sse');
    expect(jira.url).toBe('https://mcp.atlassian.com/sse');
    expect(jira.tokenHint).toBe('oken');

    // The secret must not survive into the returned object at any depth.
    expect(JSON.stringify(config)).not.toContain('gh_1234567890abcdef');
    expect(JSON.stringify(config)).not.toContain('jira-secret-token');
  });

  it('rejects an unknown transport', () => {
    expect(() =>
      parseMcpConfig(JSON.stringify({ servers: { x: { transport: 'ftp' } } }), {}),
    ).toThrow(McpConfigError);
  });

  it('rejects a declared tokenEnv whose env var is unset', () => {
    expect(() =>
      parseMcpConfig(
        JSON.stringify({
          servers: { github: { transport: 'stdio', command: 'npx', tokenEnv: 'GITHUB_TOKEN' } },
        }),
        {},
      ),
    ).toThrow(/GITHUB_TOKEN/);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseMcpConfig('{ not json', {})).toThrow(McpConfigError);
  });

  it('requires command for stdio and url for sse', () => {
    expect(() =>
      parseMcpConfig(JSON.stringify({ servers: { x: { transport: 'stdio' } } }), {}),
    ).toThrow(/command/);
    expect(() =>
      parseMcpConfig(JSON.stringify({ servers: { x: { transport: 'sse' } } }), {}),
    ).toThrow(/url/);
  });
});

describe('loadMcpConfig', () => {
  it('treats a missing file as no servers configured', () => {
    expect(loadMcpConfig('/nonexistent-mcp-config.json', {}).servers).toEqual([]);
  });
});
