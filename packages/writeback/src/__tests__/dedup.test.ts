import { describe, expect, it } from 'vitest';

import { GitProviderType, WritebackAction } from '@harness/domain';
import type { WriteBackIntent } from '@harness/domain';

import { dedupKey, effectiveBody, normalizeBody } from '../dedup.js';

function intent(overrides: Partial<WriteBackIntent> = {}): WriteBackIntent {
  return {
    id: 'wb-1',
    provider: GitProviderType.GitHub,
    externalId: '42',
    repo: 'github.com/acme/api',
    action: WritebackAction.Comment,
    body: 'LGTM',
    ...overrides,
  };
}

describe('dedup', () => {
  it('normalizeBody collapses runs of whitespace and trims', () => {
    expect(normalizeBody('  line  one\n\t line   two  ')).toBe('line one line two');
  });

  it('effectiveBody mirrors the payload each action sends (day-08 §2.2)', () => {
    expect(effectiveBody(intent({ action: WritebackAction.Comment, body: 'hi' }))).toBe('hi');
    expect(
      effectiveBody(intent({ action: WritebackAction.Status, state: 'success', body: 'verified' })),
    ).toBe('success verified');
    expect(effectiveBody(intent({ action: WritebackAction.Label, label: 'approved' }))).toBe(
      'approved',
    );
    expect(
      effectiveBody(intent({ action: WritebackAction.Transition, toState: 'In Review' })),
    ).toBe('In Review');
  });

  it('dedupKey is stable for the same intent and differs when the payload changes', () => {
    const base = intent({ action: WritebackAction.Comment, body: 'LGTM' });
    expect(dedupKey(base)).toBe(dedupKey({ ...base, id: 'wb-retry' }));

    const reformatted = intent({ action: WritebackAction.Comment, body: '  LGTM\n\n\n\n\n' });
    expect(dedupKey(base)).toBe(dedupKey(reformatted));

    const different = intent({ action: WritebackAction.Comment, body: 'needs work' });
    expect(dedupKey(base)).not.toBe(dedupKey(different));

    const differentAction = intent({
      action: WritebackAction.Status,
      state: 'success',
      body: 'LGTM',
    });
    expect(dedupKey(base)).not.toBe(dedupKey(differentAction));
  });
});
