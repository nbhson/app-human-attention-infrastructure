import { describe, expect, it } from 'vitest';

import { TicketProviderType } from '@harness/domain';

import { adfToPlainText, mapJiraIssue } from '../jira-mapper.js';

describe('adfToPlainText', () => {
  it('returns a plain string unchanged', () => {
    expect(adfToPlainText('hello')).toBe('hello');
  });

  it('concatenates nested paragraph text nodes', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'The retry ' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'loop is broken.' }] },
      ],
    };
    expect(adfToPlainText(adf)).toBe('The retry loop is broken.');
  });

  it('degrades to empty on an unknown shape', () => {
    expect(adfToPlainText(null)).toBe('');
    expect(adfToPlainText({})).toBe('');
  });
});

describe('mapJiraIssue', () => {
  it('maps a Jira payload to an Issue', () => {
    const issue = mapJiraIssue(TicketProviderType.Jira, 'https://acme.atlassian.net', {
      key: 'ACME-1234',
      fields: {
        summary: 'Fix retry loop',
        description: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Broken.' }] }],
        },
        issuetype: { name: 'Bug' },
      },
    });

    expect(issue.key).toBe('ACME-1234');
    expect(issue.summary).toBe('Fix retry loop');
    expect(issue.description).toBe('Broken.');
    expect(issue.issueType).toBe('Bug');
    expect(issue.url).toBe('https://acme.atlassian.net/browse/ACME-1234');
  });

  it('defaults issueType to Task and tolerates a missing description', () => {
    const issue = mapJiraIssue(TicketProviderType.Jira, 'https://acme.atlassian.net', {
      key: 'ACME-5',
      fields: { summary: 'x' },
    });
    expect(issue.issueType).toBe('Task');
    expect(issue.description).toBe('');
  });
});
