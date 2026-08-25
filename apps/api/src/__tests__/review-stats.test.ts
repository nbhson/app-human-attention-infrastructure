import { describe, expect, it } from 'vitest';

import { computeReviewStats, SEVERITY_ORDER } from '../review-stats.js';

describe('computeReviewStats', () => {
  it('sums per-file additions/deletions and counts files', () => {
    const stats = computeReviewStats(
      {
        files: [
          { additions: 10, deletions: 2 },
          { additions: 30, deletions: 5 },
        ],
      },
      [],
    );

    expect(stats.totalFiles).toBe(2);
    expect(stats.addedLines).toBe(40);
    expect(stats.removedLines).toBe(7);
    expect(stats.changedLines).toBe(47);
  });

  it('counts flagged files and the added lines they hold', () => {
    const findings = [
      { severity: 'CRITICAL', file: 'a.ts', line: 10 },
      { severity: 'MAJOR', file: 'a.ts', line: 11 }, // same file, deduped
      { severity: 'NIT', file: 'b.ts', line: null }, // whole-file finding, no line
    ];

    const stats = computeReviewStats(
      {
        files: [
          { path: 'a.ts', additions: 30, deletions: 5 },
          { path: 'b.ts', additions: 20, deletions: 0 },
          { path: 'c.ts', additions: 50, deletions: 0 }, // no finding → not flagged
        ],
      },
      findings,
    );

    expect(stats.flaggedFiles).toBe(2); // a.ts + b.ts
    expect(stats.flaggedAddedLines).toBe(50); // 30 + 20
    expect(stats.addedLines).toBe(100);
    expect(stats.attentionShare).toBe(0.5); // 50 / 100
  });

  it('counts findings per severity band, every band present', () => {
    const findings = [
      { severity: 'CRITICAL', file: 'a.ts', line: 1 },
      { severity: 'CRITICAL', file: 'b.ts', line: 1 },
      { severity: 'MINOR', file: 'c.ts', line: 1 },
    ];

    const stats = computeReviewStats({ files: [] }, findings);

    expect(stats.findingTotal).toBe(3);
    expect(stats.severity.CRITICAL).toBe(2);
    expect(stats.severity.MINOR).toBe(1);
    for (const band of SEVERITY_ORDER) {
      expect(typeof stats.severity[band]).toBe('number');
    }
    expect(stats.severity.MAJOR).toBe(0);
  });

  it('is safe against an empty pr_payload and null findings', () => {
    const stats = computeReviewStats({}, []);
    expect(stats.changedLines).toBe(0);
    expect(stats.attentionShare).toBe(0);
    expect(stats.findingTotal).toBe(0);
  });

  it('measures attention as flagged added lines over all added lines', () => {
    const findings = [
      { severity: 'CRITICAL', file: 'a.ts', line: 1 },
      { severity: 'CRITICAL', file: 'a.ts', line: 2 },
    ];

    const stats = computeReviewStats(
      {
        files: [
          { path: 'a.ts', additions: 5, deletions: 0 },
          { path: 'b.ts', additions: 15, deletions: 0 },
        ],
      },
      findings,
    );

    expect(stats.flaggedAddedLines).toBe(5);
    expect(stats.attentionShare).toBe(0.25); // 5 / 20, not ~0 from one anchor over 20 changed lines
  });
});
