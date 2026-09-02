import { describe, expect, it } from 'vitest';

import type { ReviewExampleRow } from '../review-example.js';
import { filterByScaleVersion, toReviewExample } from '../review-example.js';

const ROW: ReviewExampleRow = {
  id: 'eg-1',
  scaleVersion: 'v1',
  labelSet: 'severity-routing-useful',
  source: 'phase2-review-redacted-001',
  prDiff: 'diff --git a/src/service.ts b/src/service.ts\n',
  requirement: 'Add a null guard.',
  report: {
    verdict: 'REQUEST_CHANGES',
    summary: 'Needs a null guard before dereference.',
    findings: [{ severity: 'CRITICAL', file: 'src/service.ts', line: 41, message: 'Missing null check.' }],
  },
  goldSeverity: 0.9,
  goldRouting: 0.8,
  goldUseful: true,
  createdAt: new Date(0),
};

describe('toReviewExample', () => {
  it('bundles the flattened gold columns back into a nested gold label', () => {
    const example = toReviewExample(ROW);

    expect(example.id).toBe('eg-1');
    expect(example.scaleVersion).toBe('v1');
    expect(example.labelSet).toBe('severity-routing-useful');
    expect(example.report).toBe(ROW.report);
    expect(example.gold).toEqual({ severity: 0.9, routing: 0.8, useful: true });
    expect(example.createdAt).toBe(ROW.createdAt);
  });

  it('preserves every non-gold field verbatim', () => {
    const example = toReviewExample(ROW);

    expect(example.source).toBe(ROW.source);
    expect(example.prDiff).toBe(ROW.prDiff);
    expect(example.requirement).toBe(ROW.requirement);
  });
});

describe('filterByScaleVersion', () => {
  it('keeps only examples tagged with the requested scale version', () => {
    const v1 = toReviewExample(ROW);
    const v2 = toReviewExample({ ...ROW, id: 'eg-2', scaleVersion: 'v2' });

    expect(filterByScaleVersion([v1, v2], 'v1')).toEqual([v1]);
    expect(filterByScaleVersion([v1, v2], 'v2')).toEqual([v2]);
  });

  it('returns an empty list when no example matches', () => {
    expect(filterByScaleVersion([toReviewExample(ROW)], 'v99')).toEqual([]);
  });
});
