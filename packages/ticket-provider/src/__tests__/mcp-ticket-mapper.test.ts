import { describe, expect, it } from 'vitest';

import { TicketProviderType } from '@harness/domain';
import type { ToolResult } from '@harness/mcp';

import { TicketProviderError } from '../ticket-provider.js';
import { mapMcpTicketIssue } from '../mcp-ticket-mapper.js';

function textResult(json: unknown, isError = false): ToolResult {
  return {
    isError,
    content: [{ type: 'text', text: JSON.stringify(json) }],
  };
}

const ISSUE_PAYLOAD = {
  key: 'ACME-1234',
  fields: {
    summary: 'Fix retry loop',
    description: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Broken.' }] }],
    },
    issuetype: { name: 'Bug' },
  },
};

describe('mapMcpTicketIssue', () => {
  it('assembles an Issue identical to the REST mapper output', () => {
    const issue = mapMcpTicketIssue(
      TicketProviderType.Jira,
      'https://acme.atlassian.net',
      textResult(ISSUE_PAYLOAD),
    );

    expect(issue).toEqual({
      provider: 'jira',
      key: 'ACME-1234',
      summary: 'Fix retry loop',
      description: 'Broken.',
      issueType: 'Bug',
      url: 'https://acme.atlassian.net/browse/ACME-1234',
    });
  });

  it('defaults issueType to Task and tolerates a missing description', () => {
    const issue = mapMcpTicketIssue(
      TicketProviderType.Jira,
      'https://acme.atlassian.net',
      textResult({ key: 'ACME-5', fields: { summary: 'x' } }),
    );
    expect(issue.issueType).toBe('Task');
    expect(issue.description).toBe('');
  });

  it('accepts a resource content block carrying JSON', () => {
    const result: ToolResult = {
      isError: false,
      content: [
        {
          type: 'resource',
          resource: { uri: 'jira://ACME-1234', text: JSON.stringify(ISSUE_PAYLOAD) },
        },
      ],
    };
    const issue = mapMcpTicketIssue(TicketProviderType.Jira, 'https://acme.atlassian.net', result);
    expect(issue.key).toBe('ACME-1234');
  });

  it('throws when the tool returns isError', () => {
    expect(() =>
      mapMcpTicketIssue(
        TicketProviderType.Jira,
        'https://acme.atlassian.net',
        textResult(ISSUE_PAYLOAD, true),
      ),
    ).toThrow(TicketProviderError);
  });

  it('throws on malformed content (no JSON payload)', () => {
    const result: ToolResult = { isError: false, content: [{ type: 'text', text: 'not json' }] };
    expect(() =>
      mapMcpTicketIssue(TicketProviderType.Jira, 'https://acme.atlassian.net', result),
    ).toThrow(/no JSON payload/);
  });

  it('throws on a missing key', () => {
    expect(() =>
      mapMcpTicketIssue(
        TicketProviderType.Jira,
        'https://acme.atlassian.net',
        textResult({ fields: { summary: 'x' } }),
      ),
    ).toThrow(/key/);
  });

  it('throws on a missing fields.summary', () => {
    expect(() =>
      mapMcpTicketIssue(
        TicketProviderType.Jira,
        'https://acme.atlassian.net',
        textResult({ key: 'ACME-1', fields: {} }),
      ),
    ).toThrow(/summary/);
  });
});
