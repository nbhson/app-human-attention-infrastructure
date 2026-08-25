import { describe, expect, it } from 'vitest';

import { computeReviewStats, SEVERITY_ORDER } from '../review-stats.js';

describe('computeReviewStats', () => {
  it('sums source-file additions/deletions and counts source files', () => {
    const stats = computeReviewStats(
      {
        files: [
          { path: 'src/a.ts', additions: 10, deletions: 2 },
          { path: 'src/b.ts', additions: 30, deletions: 5 },
          { path: 'package-lock.json', additions: 9000, deletions: 0 }, // generated → excluded
          { path: 'README.md', additions: 400, deletions: 0 }, // doc → excluded
          { path: 'Dockerfile', additions: 12, deletions: 0 }, // infra → excluded
        ],
      },
      [],
    );

    expect(stats.totalFiles).toBe(2);
    expect(stats.addedLines).toBe(40);
    expect(stats.removedLines).toBe(7);
    expect(stats.changedLines).toBe(47);
  });

  it('counts actionable files and the added lines they hold (NIT/INFO excluded)', () => {
    const findings = [
      { severity: 'CRITICAL', file: 'a.ts', line: 10 },
      { severity: 'MAJOR', file: 'a.ts', line: 11 }, // same file, deduped
      { severity: 'NIT', file: 'b.ts', line: null }, // nitpick → not flagged
      { severity: 'INFO', file: 'd.ts', line: null }, // praise → not flagged
    ];

    const stats = computeReviewStats(
      {
        files: [
          { path: 'a.ts', additions: 30, deletions: 5 },
          { path: 'b.ts', additions: 20, deletions: 0 }, // NIT only
          { path: 'c.ts', additions: 50, deletions: 0 }, // no finding
          { path: 'd.ts', additions: 10, deletions: 0 }, // INFO only
        ],
      },
      findings,
    );

    expect(stats.flaggedFiles).toBe(1); // a.ts only
    expect(stats.flaggedAddedLines).toBe(30); // 30, not 30+20+10
    expect(stats.addedLines).toBe(110);
    expect(stats.attentionShare).toBe(0.2727); // 30 / 110
  });

  it('never flags non-source files, even with an actionable finding', () => {
    const findings = [
      { severity: 'CRITICAL', file: 'node_modules/', line: null }, // generated dir prefix
      { severity: 'MAJOR', file: 'README.md', line: null }, // doc
      { severity: 'MINOR', file: 'Dockerfile', line: null }, // infra
      { severity: 'MINOR', file: 'src/app.ts', line: 3 }, // real source
    ];

    const stats = computeReviewStats(
      {
        files: [
          { path: 'src/app.ts', additions: 40, deletions: 0 },
          { path: 'README.md', additions: 364, deletions: 0 },
          { path: 'Dockerfile', additions: 11, deletions: 0 },
        ],
      },
      findings,
    );

    expect(stats.flaggedFiles).toBe(1); // src/app.ts only
    expect(stats.flaggedAddedLines).toBe(40);
    expect(stats.addedLines).toBe(40); // README + Dockerfile excluded from the whole block
    expect(stats.attentionShare).toBe(1); // 40 / 40
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
