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

  it('computes flagged lines as distinct file:line anchors and flagged files', () => {
    const findings = [
      { severity: 'CRITICAL', file: 'a.ts', line: 10 },
      { severity: 'MAJOR', file: 'a.ts', line: 10 }, // duplicate anchor → deduped
      { severity: 'MAJOR', file: 'a.ts', line: 11 },
      { severity: 'NIT', file: 'b.ts', line: null }, // whole-file finding, no line
    ];

    const stats = computeReviewStats({ files: [{ additions: 50, deletions: 50 }] }, findings);

    expect(stats.flaggedFiles).toBe(2); // a.ts + b.ts
    expect(stats.flaggedLines).toBe(2); // a.ts:10 and a.ts:11
    expect(stats.attentionShare).toBe(0.02); // 2 / 100
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

  it('clamps attentionShare to 1 when anchors exceed changed lines', () => {
    const findings = [
      { severity: 'CRITICAL', file: 'a.ts', line: 1 },
      { severity: 'CRITICAL', file: 'a.ts', line: 2 },
    ];
    const stats = computeReviewStats({ files: [{ additions: 1, deletions: 0 }] }, findings);
    expect(stats.attentionShare).toBe(1);
  });
});
