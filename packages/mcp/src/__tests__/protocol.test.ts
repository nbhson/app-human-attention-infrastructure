import { describe, expect, it } from 'vitest';

import { McpClientError } from '../errors.js';
import { parseServerInfo, parseToolResult, parseToolsList } from '../protocol.js';

describe('parseServerInfo', () => {
  it('parses the initialize result', () => {
    expect(
      parseServerInfo({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'github', version: '1.2.3' },
      }),
    ).toEqual({ name: 'github', version: '1.2.3', capabilities: { tools: {} } });
  });

  it('rejects a missing serverInfo', () => {
    expect(() => parseServerInfo({ capabilities: {} })).toThrow(McpClientError);
  });

  it('rejects a non-object result', () => {
    expect(() => parseServerInfo('nope')).toThrow(McpClientError);
  });
});

describe('parseToolsList', () => {
  it('parses tools', () => {
    expect(
      parseToolsList({ tools: [{ name: 'a', description: 'd', inputSchema: { type: 'object' } }] }),
    ).toEqual([{ name: 'a', description: 'd', inputSchema: { type: 'object' } }]);
  });

  it('tolerates absent optional fields', () => {
    expect(parseToolsList({ tools: [{ name: 'a' }] })).toEqual([{ name: 'a' }]);
  });

  it('rejects a missing tools array', () => {
    expect(() => parseToolsList({})).toThrow(McpClientError);
  });
});

describe('parseToolResult', () => {
  it('parses text content', () => {
    expect(parseToolResult({ isError: false, content: [{ type: 'text', text: 'hi' }] })).toEqual({
      isError: false,
      content: [{ type: 'text', text: 'hi' }],
    });
  });

  it('parses image and resource content', () => {
    expect(
      parseToolResult({
        isError: true,
        content: [
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
          { type: 'resource', resource: { uri: 'file://x' } },
        ],
      }),
    ).toEqual({
      isError: true,
      content: [
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
        { type: 'resource', resource: { uri: 'file://x' } },
      ],
    });
  });

  it('rejects an unknown content type', () => {
    expect(() => parseToolResult({ content: [{ type: 'wat', text: 'x' }] })).toThrow(
      McpClientError,
    );
  });

  it('rejects a missing content array', () => {
    expect(() => parseToolResult({})).toThrow(McpClientError);
  });
});
