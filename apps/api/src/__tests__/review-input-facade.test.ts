import { describe, expect, it } from 'vitest';

import { parsePrUrl, ReviewInputError } from '../review-input-facade.js';

describe('parsePrUrl', () => {
  it('parses a GitHub pull-request URL', () => {
    expect(parsePrUrl('https://github.com/acme/widget/pull/123')).toEqual({
      repo: 'github.com/acme/widget',
      number: 123,
    });
  });

  it('parses a GitLab merge-request URL', () => {
    expect(parsePrUrl('https://gitlab.com/acme/widget/-/merge_requests/7')).toEqual({
      repo: 'gitlab.com/acme/widget',
      number: 7,
    });
  });

  it('preserves a GitLab nested-group project path', () => {
    expect(parsePrUrl('https://gitlab.com/group/subgroup/widget/-/merge_requests/9')).toEqual({
      repo: 'gitlab.com/group/subgroup/widget',
      number: 9,
    });
  });

  it('parses a Bitbucket pull-request URL', () => {
    expect(parsePrUrl('https://bitbucket.org/acme/widget/pull-requests/3')).toEqual({
      repo: 'bitbucket.org/acme/widget',
      number: 3,
    });
  });

  it('normalises a www-prefixed host to the canonical token', () => {
    expect(parsePrUrl('https://www.github.com/acme/widget/pull/2')).toEqual({
      repo: 'github.com/acme/widget',
      number: 2,
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parsePrUrl('https://github.com/acme/widget/pull/5/')).toEqual({
      repo: 'github.com/acme/widget',
      number: 5,
    });
  });

  it('rejects a malformed URL', () => {
    expect(() => parsePrUrl('not a url')).toThrow(ReviewInputError);
    expect(() => parsePrUrl('not a url')).toThrow(/not a valid URL/);
  });

  it('rejects an unsupported Git host', () => {
    expect(() => parsePrUrl('https://sourceforge.net/acme/widget/pull/1')).toThrow(
      /unsupported Git host "sourceforge.net"/,
    );
  });

  it('rejects a URL with the wrong path shape for its host', () => {
    // A GitHub URL missing the `/pull/N` segment.
    expect(() => parsePrUrl('https://github.com/acme/widget')).toThrow(/not a GitHub pull-request URL/);
    // A GitLab URL missing the `/-/merge_requests/N` segment.
    expect(() => parsePrUrl('https://gitlab.com/acme/widget/pull/1')).toThrow(/not a GitLab merge-request URL/);
  });

  it('rejects a non-numeric PR number', () => {
    expect(() => parsePrUrl('https://github.com/acme/widget/pull/abc')).toThrow(/not a GitHub pull-request URL/);
  });

  it('exposes an HTTP status on every parse error', () => {
    try {
      parsePrUrl('https://evil.example/no');
    } catch (error) {
      expect((error as ReviewInputError).status).toBe(400);
    }
  });
});
