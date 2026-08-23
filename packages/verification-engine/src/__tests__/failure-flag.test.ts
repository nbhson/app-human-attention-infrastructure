import { describe, expect, it } from 'vitest';

import { FLAG_TAIL_LENGTH, flagReport, tailOf } from '../report-flag.js';
import { renderFlag } from '../report-render.js';
import type { CheckResult } from '../types.js';
import { CheckKind, CheckStatus } from '../types.js';

/** A check result fixture with sensible defaults. */
function check(
  kind: CheckKind,
  status: CheckStatus,
  overrides: Partial<CheckResult> = {},
): CheckResult {
  return { checkKind: kind, status, durationMs: 1, output: '', ...overrides };
}

describe('flagReport (day-13 §2)', () => {
  it('is a green flag when every check passed — no failed/timed-out kinds, no flags', () => {
    const flag = flagReport([
      check(CheckKind.COMPILE, CheckStatus.PASSED),
      check(CheckKind.TEST, CheckStatus.PASSED),
    ]);

    expect(flag.verdict).toBe('PASSED');
    expect(flag.failed).toBe(false);
    expect(flag.failedKinds).toEqual([]);
    expect(flag.timedOutKinds).toEqual([]);
    expect(flag.failedChecks).toEqual([]);
  });

  it('treats FLAKY as passed-but-flagged — not a red verdict', () => {
    const flag = flagReport([check(CheckKind.TEST, CheckStatus.FLAKY)]);

    expect(flag.verdict).toBe('PASSED');
    expect(flag.failed).toBe(false);
    expect(flag.failedChecks).toEqual([]);
  });

  it('carries the evidence ref + exit code + tail for a code FAILED', () => {
    const flag = flagReport([
      check(CheckKind.COMPILE, CheckStatus.FAILED, {
        exitCode: 2,
        evidenceId: 'evt_123',
        output: 'TS2322: boom',
      }),
    ]);

    expect(flag.failed).toBe(true);
    expect(flag.failedKinds).toEqual([CheckKind.COMPILE]);
    expect(flag.timedOutKinds).toEqual([]);
    expect(flag.failedChecks).toEqual([
      {
        kind: CheckKind.COMPILE,
        status: CheckStatus.FAILED,
        exitCode: 2,
        evidenceRef: 'evt_123',
        tail: 'TS2322: boom',
      },
    ]);
  });

  it('keeps TIMED_OUT (infra) distinct from FAILED (code) — §2.3', () => {
    const flag = flagReport([
      check(CheckKind.TEST, CheckStatus.TIMED_OUT, { exitCode: 137, evidenceId: 'evt_t' }),
      check(CheckKind.COMPILE, CheckStatus.FAILED, { exitCode: 1 }),
    ]);

    expect(flag.failed).toBe(true);
    // A container kill lands under timedOutKinds, a non-zero exit under failedKinds.
    expect(flag.timedOutKinds).toEqual([CheckKind.TEST]);
    expect(flag.failedKinds).toEqual([CheckKind.COMPILE]);
    expect(flag.failedChecks.map((f) => f.status)).toEqual([
      CheckStatus.TIMED_OUT,
      CheckStatus.FAILED,
    ]);
    // The timeout surfaces its kill code too, but stays classified infra.
    expect(flag.failedChecks[0]?.exitCode).toBe(137);
    expect(flag.failedChecks[0]?.evidenceRef).toBe('evt_t');
  });

  it('excludes SKIPPED from every list — a suppressed check never ran', () => {
    const flag = flagReport([
      check(CheckKind.COMPILE, CheckStatus.FAILED, { exitCode: 2 }),
      check(CheckKind.TEST, CheckStatus.SKIPPED),
    ]);

    expect(flag.failedKinds).toEqual([CheckKind.COMPILE]);
    expect(flag.timedOutKinds).toEqual([]);
    expect(flag.failedChecks).toHaveLength(1);
  });

  it('omits exitCode and evidenceRef when absent (exactOptionalPropertyTypes)', () => {
    const flag = flagReport([check(CheckKind.LINT, CheckStatus.FAILED, { output: 'lint failed' })]);

    const flagged = flag.failedChecks[0];
    expect(flagged).toBeDefined();
    expect('exitCode' in (flagged as object)).toBe(false);
    expect('evidenceRef' in (flagged as object)).toBe(false);
    expect(flagged?.tail).toBe('lint failed');
  });

  it('is information, not a gate — the flag carries no decision field', () => {
    const flag = flagReport([check(CheckKind.COMPILE, CheckStatus.FAILED, { exitCode: 1 })]);

    // The flag describes what happened. It must NOT smuggle a routing/decision
    // choice (approve/reject/rework) — that stays with the human-decision gate.
    expect('decision' in (flag as object)).toBe(false);
    expect('rework' in (flag as object)).toBe(false);
  });

  it('is a pure read — same checks in, an identical flag out (no ordering side-effects)', () => {
    const checks = [
      check(CheckKind.COMPILE, CheckStatus.FAILED, { exitCode: 2 }),
      check(CheckKind.TEST, CheckStatus.PASSED),
    ];
    expect(flagReport(checks)).toEqual(flagReport(checks));
  });
});

describe('tailOf', () => {
  it('returns short output unchanged', () => {
    expect(tailOf('ok')).toBe('ok');
  });

  it('keeps only the trailing FLAG_TAIL_LENGTH characters with a truncation marker', () => {
    const body = 'x'.repeat(FLAG_TAIL_LENGTH + 500);
    const tail = tailOf(body);

    expect(tail).toContain('earlier output truncated');
    expect(tail.length).toBeGreaterThan(FLAG_TAIL_LENGTH); // marker + tail
    expect(tail).toContain('x'.repeat(FLAG_TAIL_LENGTH));
    expect(tail.length).toBeLessThan(body.length);
  });
});

describe('renderFlag (day-13 §3.4)', () => {
  it('collapses a green flag to a single line, no evidence dump', () => {
    const flag = flagReport([check(CheckKind.TEST, CheckStatus.PASSED)]);
    expect(renderFlag(flag)).toBe('## Verification — PASSED\n');
  });

  it('renders the FAILED breakdown, marking review required with code vs infra apart', () => {
    const flag = flagReport([
      check(CheckKind.COMPILE, CheckStatus.FAILED, {
        exitCode: 2,
        evidenceId: 'evt_1',
        output: 'TS2322: boom',
      }),
      check(CheckKind.TEST, CheckStatus.TIMED_OUT, { exitCode: 137, evidenceId: 'evt_2' }),
    ]);

    const out = renderFlag(flag);

    expect(out).toContain('## Verification — FAILED');
    expect(out).toContain('failed (code): COMPILE');
    expect(out).toContain('timed out (infra): TEST');
    expect(out).toContain('Review required before any write-back');
    expect(out).toContain('❌ COMPILE — FAILED');
    expect(out).toContain('⏱ TEST — TIMED_OUT');
    expect(out).toContain('- exit code: `2`');
    expect(out).toContain('- evidence: `evt_1`');
    expect(out).toContain('TS2322: boom');
  });

  it('omits exit code and evidence lines when they are absent', () => {
    const flag = flagReport([check(CheckKind.LINT, CheckStatus.FAILED, { output: 'e' })]);

    const out = renderFlag(flag);

    expect(out).not.toContain('exit code');
    expect(out).not.toContain('evidence');
    expect(out).toContain('❌ LINT — FAILED');
  });
});
