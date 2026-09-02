import { describe, expect, it } from 'vitest';

import { TicketProviderType } from '@harness/domain';

import { StaticTicketToolMap } from '../ticket-tool-map.js';

describe('StaticTicketToolMap', () => {
  const map = new StaticTicketToolMap();

  it('resolves the Jira read + write tools by system', () => {
    expect(map.resolve(TicketProviderType.Jira)).toEqual({
      getIssueTool: 'get_issue',
      commentTool: 'add_comment',
      transitionTool: 'transition_issue',
    });
  });

  it('encodes the Jira get-issue argument shape', () => {
    expect(map.buildArgs(TicketProviderType.Jira, { key: 'ACME-1234' })).toEqual({
      issue_id_or_key: 'ACME-1234',
    });
  });

  it('encodes the Jira comment argument shape', () => {
    expect(map.buildCommentArgs(TicketProviderType.Jira, { key: 'ACME-1234', body: 'looks good' })).toEqual({
      issue_id_or_key: 'ACME-1234',
      body: 'looks good',
    });
  });

  it('encodes the Jira transition argument shape', () => {
    expect(
      map.buildTransitionArgs(TicketProviderType.Jira, {
        key: 'ACME-1234',
        targetState: 'In Review',
      }),
    ).toEqual({ issue_id_or_key: 'ACME-1234', target_status: 'In Review' });
  });

  it('throws on a system with no entry', () => {
    // `Jira` is the only system; a fabricated token must fail loudly.
    expect(() => map.resolve('zendesk' as never)).toThrow(/no ticket tool map entry/);
    expect(() => map.buildArgs('zendesk' as never, { key: 'Z-1' })).toThrow(/no ticket tool map entry/);
  });
});
