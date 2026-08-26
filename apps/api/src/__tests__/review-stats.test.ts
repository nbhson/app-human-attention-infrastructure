import { describe, expect, it } from 'vitest';

import { computeReviewStats, SEVERITY_ORDER } from '../review-stats.js';

describe('computeReviewStats', () => {
  it('sums hand-written file additions/deletions and counts reviewable files', () => {
    const stats = computeReviewStats(
      {
        files: [
          { path: 'src/a.ts', additions: 10, deletions: 2 },
          { path: 'src/b.ts', additions: 30, deletions: 5 },
          { path: 'package-lock.json', additions: 9000, deletions: 0 }, // generated → excluded
          { path: 'README.md', additions: 400, deletions: 0 }, // doc → counts now
          { path: 'Dockerfile', additions: 12, deletions: 0 }, // infra → counts now
        ],
      },
      [],
    );

    expect(stats.totalFiles).toBe(4);
    expect(stats.addedLines).toBe(452); // 10 + 30 + 400 + 12
    expect(stats.removedLines).toBe(7); // 2 + 5
    expect(stats.changedLines).toBe(459);
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
    expect(stats.attentionShare).toBe(0.25); // 1 flagged file / 4 source files
  });

  it('flags config/infra files but never generated artifacts', () => {
    const findings = [
      { severity: 'CRITICAL', file: 'node_modules/.bin/x', line: null }, // generated → ignored
      { severity: 'MAJOR', file: 'Dockerfile', line: null }, // infra → counts
      { severity: 'MINOR', file: 'README.md', line: null }, // doc → counts
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

    expect(stats.flaggedFiles).toBe(3); // app.ts + README.md + Dockerfile
    expect(stats.flaggedAddedLines).toBe(415); // 40 + 364 + 11
    expect(stats.addedLines).toBe(415);
    expect(stats.attentionShare).toBe(1); // 3 flagged / 3 files
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

  it('measures attention as the share of source files with an actionable finding', () => {
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
    expect(stats.attentionShare).toBe(0.5); // 1 flagged file / 2 source files, not 5 lines / 20 lines
  });

  it('splits the diff by category (docs/config land in `config`) and names the flagged files', () => {
    const stats = computeReviewStats(
      {
        files: [
          { path: 'src/toeic.service.ts', additions: 605, deletions: 0 },
          { path: 'src/toeic.service.spec.ts', additions: 543, deletions: 0 },
          { path: 'src/_badges.scss', additions: 75, deletions: 0 },
          { path: 'src/app.component.html', additions: 9, deletions: 0 },
          { path: 'package-lock.json', additions: 8776, deletions: 0 }, // generated → excluded
          { path: 'README.md', additions: 364, deletions: 0 }, // doc → now in scope
        ],
      },
      [
        { severity: 'MAJOR', file: 'src/toeic.service.ts', line: 33 },
        { severity: 'MINOR', file: 'src/toeic.service.ts', line: 9 },
        { severity: 'CRITICAL', file: 'src/toeic.service.spec.ts', line: null },
        { severity: 'NIT', file: 'src/toeic.service.spec.ts', line: null }, // nitpick → not flagged
      ],
    );

    expect(stats.addedLines).toBe(1596); // 605 + 543 + 75 + 9 + 364, lockfile out
    expect(stats.composition).toEqual([
      { category: 'test', files: 1, additions: 543, deletions: 0 },
      { category: 'style', files: 1, additions: 75, deletions: 0 },
      { category: 'markup', files: 1, additions: 9, deletions: 0 },
      { category: 'source', files: 1, additions: 605, deletions: 0 },
      { category: 'config', files: 1, additions: 364, deletions: 0 },
    ]);
    expect(stats.excluded).toEqual({
      files: 1,
      additions: 8776,
      deletions: 0,
      filesList: [{ path: 'package-lock.json', additions: 8776, deletions: 0 }],
    });
    // NIT dropped; severities grouped per file, worst-first.
    expect(stats.flaggedFilesList).toEqual([
      { file: 'src/toeic.service.spec.ts', severities: ['CRITICAL'] },
      { file: 'src/toeic.service.ts', severities: ['MAJOR', 'MINOR'] },
    ]);
  });

  it('tallies cleanup findings per source file as a parallel signal', () => {
    const findings = [
      { severity: 'MINOR', kind: 'cleanup', file: 'src/dead.ts', line: 4 },
      { severity: 'NIT', kind: 'cleanup', file: 'src/dead.ts', line: 9 },
      { severity: 'NIT', kind: 'cleanup', file: 'src/dup.ts', line: null },
      { severity: 'MAJOR', kind: 'correctness', file: 'src/app.ts', line: 1 },
    ];

    const stats = computeReviewStats(
      {
        files: [
          { path: 'src/dead.ts', additions: 10, deletions: 0 },
          { path: 'src/dup.ts', additions: 20, deletions: 0 },
          { path: 'src/app.ts', additions: 30, deletions: 0 },
        ],
      },
      findings,
    );

    // Cleanup counts every severity (the NIT "unused function" is still surfacing).
    expect(stats.cleanup.files).toBe(2); // dead.ts + dup.ts
    expect(stats.cleanup.findings).toBe(3); // two on dead.ts + one on dup.ts
    expect(stats.cleanup.filesList).toEqual([
      { file: 'src/dead.ts', count: 2 },
      { file: 'src/dup.ts', count: 1 },
    ]);
    // Attention stays severity-based: dead.ts (MINOR) + app.ts (MAJOR) are flagged,
    // dup.ts (NIT only) is not — kind does not gate attention, it runs alongside.
    expect(stats.flaggedFiles).toBe(2);
    expect(stats.attentionShare).toBe(0.6667); // 2/3, rounded to 4 dp
  });

  it('never tallies cleanup for non-source files', () => {
    const stats = computeReviewStats(
      { files: [{ path: 'README.md', additions: 20, deletions: 0 }] },
      [{ severity: 'NIT', kind: 'cleanup', file: 'README.md', line: 1 }],
    );

    expect(stats.cleanup.files).toBe(0);
    expect(stats.cleanup.findings).toBe(0);
    expect(stats.cleanup.filesList).toEqual([]);
  });
});
