/**
 * `report-render` (day-13 §3.4) — render a {@link VerificationFlag} as markdown.
 *
 * The human reads a verification failure as prose, not as a row of booleans. This
 * is a pure, dependency-free serializer: in goes the flag (already assembled by
 * `report-flag.ts`), out comes markdown the review detail view can drop into a
 * "Verification" section untouched. It never fetches evidence, never mutates the
 * report, and never renders a decision it doesn't carry — a FAILED flag becomes
 * "review required", which is exactly the human gate the flag must not bypass.
 *
 * Kept inside the verification engine (not `@harness/review`) because the review
 * package may not import this one (boundary rule R4): the flag's own package is
 * the only place that can own its rendering without dragging a cross-engine
 * dependency in for a string.
 */

import { CheckStatus } from './types.js';
import type { FlaggedCheck, VerificationFlag } from './report-flag.js';

/**
 * Serialize a flag to markdown for a human reviewer.
 *
 * A PASSED flag collapses to a single line. A FAILED flag lists the honest
 * breakdown — failed (code) alongside timed-out (infra) — then one fenced block
 * per flag-worthy check with its exit code, evidence ref, and output tail.
 */
export function renderFlag(flag: VerificationFlag): string {
  if (!flag.failed) {
    return '## Verification — PASSED\n';
  }

  const lines: string[] = [
    '## Verification — FAILED',
    '',
    '_Verification is information, not a gate — the human decides._',
    '',
    '**Review required before any write-back.**',
  ];
  if (flag.failedKinds.length > 0) {
    lines.push(`- failed (code): ${flag.failedKinds.join(', ')}`);
  }
  if (flag.timedOutKinds.length > 0) {
    lines.push(`- timed out (infra): ${flag.timedOutKinds.join(', ')}`);
  }
  for (const check of flag.failedChecks) {
    lines.push('', renderFlaggedCheck(check));
  }
  return `${lines.join('\n')}\n`;
}

/** One flag-worthy check as a headed, fenced block. */
function renderFlaggedCheck(check: FlaggedCheck): string {
  const lines: string[] = [
    `### ${check.status === CheckStatus.TIMED_OUT ? '⏱' : '❌'} ${check.kind} — ${check.status}`,
  ];
  if (check.exitCode !== undefined) {
    lines.push(`- exit code: \`${check.exitCode}\``);
  }
  if (check.evidenceRef !== undefined) {
    lines.push(`- evidence: \`${check.evidenceRef}\``);
  }
  if (check.tail.length > 0) {
    lines.push('', '```', check.tail, '```');
  }
  return lines.join('\n');
}
