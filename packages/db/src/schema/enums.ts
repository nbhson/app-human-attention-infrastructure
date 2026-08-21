/**
 * Status / type CHECK constraints for `@harness/db`.
 *
 * Every `state`, `status`, `*_type`, `label`, and `decision` column is a plain
 * `text` column (readable in raw SQL — see `day-04.md` §2.3) whose allowed
 * values are enforced by a CHECK constraint.
 *
 * The value lists below live *in this file* (not imported from `@harness/domain`)
 * so that `drizzle-kit generate` can evaluate the schema without pulling in an
 * ESM-only workspace package. Parity with the domain const objects is enforced
 * by the drift test in `enums.test.ts` — `@harness/domain` is the source of
 * truth; if these drift, the test (and CI) fail.
 */
import { sql } from 'drizzle-orm';
import { check, type CheckBuilder } from 'drizzle-orm/pg-core';

/** Build a named `<column> IN ('a', 'b', ...)` CHECK constraint. */
function inList(constraintName: string, column: string, values: readonly string[]): CheckBuilder {
  const list = values.map((value) => `'${value}'`).join(', ');
  return check(constraintName, sql.raw(`${column} IN (${list})`));
}

/** `tasks.state` — the full canonical Task status machine (13 states). */
export const taskStates = [
  'PENDING',
  'QUEUED',
  'EXECUTING',
  'VERIFYING',
  'AWAITING_REVIEW',
  'APPROVED',
  'REJECTED',
  'REWORK',
  'COMPLETED',
  'FAILED',
  'AWAITING_HUMAN_INTERVENTION',
  'CANCELLED',
  'RETRYING',
] as const;

export const agentRunStatuses = [
  'INITIALIZED',
  'PLANNING',
  'EXECUTING',
  'TOOL_CALLING',
  'OBSERVING',
  'FINALIZING',
  'COMPLETED',
  'FAILED',
  'ESCALATED',
  'CANCELLED',
  'ERROR',
] as const;

export const artifactStatuses = [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
  'MERGED',
] as const;

export const changeStatuses = ['PENDING', 'VERIFIED', 'REVIEWED', 'ROLLED_BACK'] as const;

export const fileChangeTypes = ['CREATED', 'MODIFIED', 'DELETED', 'RENAMED'] as const;

export const verificationStatuses = [
  'RUNNING',
  'PASSED',
  'FAILED',
  'ERROR',
  'TIMEOUT',
  'SKIPPED',
] as const;

export const priorityLabels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/**
 * Per-check result status (day-15 §2.1, engine-local `CheckStatus`). Distinct
 * from the overall `verificationStatuses` above: `TIMED_OUT` names a single
 * check that exceeded its budget, whereas `TIMEOUT` is an overall verification
 * outcome. `CheckStatus` lives in `@harness/verification-engine` (an engine may
 * not be imported by `db`), so these are plain-text copies, like the domain
 * enums above.
 */
export const checkStatuses = ['PASSED', 'FAILED', 'FLAKY', 'TIMED_OUT', 'SKIPPED'] as const;

/** Per-test result status (day-16 §2.3): the leaf outcome inside a TEST check. */
export const testResultStatuses = ['PASSED', 'FAILED', 'SKIPPED'] as const;

/** `verification_reports.overall` — the two possible aggregate verdicts. */
export const reportOverallStatuses = ['PASSED', 'FAILED'] as const;

export const humanDecisionTypes = [
  'APPROVED',
  'REJECTED',
  'REQUEST_CHANGES',
  'OVERRIDDEN',
  'DEFERRED',
  'ESCALATED',
] as const;

/** `tasks.state`. */
export const taskStateCheck = inList('tasks_state_check', 'state', taskStates);

/** `agent_runs.status`. */
export const agentRunStatusCheck = inList('agent_runs_status_check', 'status', agentRunStatuses);

/** `artifacts.status`. */
export const artifactStatusCheck = inList('artifacts_status_check', 'status', artifactStatuses);

/** `changes.status`. */
export const changeStatusCheck = inList('changes_status_check', 'status', changeStatuses);

/** `changes.change_type`. */
export const fileChangeTypeCheck = inList(
  'changes_change_type_check',
  'change_type',
  fileChangeTypes,
);

/** `verification_results.status`. */
export const verificationStatusCheck = inList(
  'verification_results_status_check',
  'status',
  verificationStatuses,
);

/** `verification_check_results.status`. */
export const checkStatusCheck = inList(
  'verification_check_results_status_check',
  'status',
  checkStatuses,
);

/** `verification_test_results.status`. */
export const testResultStatusCheck = inList(
  'verification_test_results_status_check',
  'status',
  testResultStatuses,
);

/** `verification_reports.overall`. */
export const reportOverallCheck = inList(
  'verification_reports_overall_check',
  'overall',
  reportOverallStatuses,
);

/** `assessments.label`. */
export const priorityLabelCheck = inList('assessments_label_check', 'label', priorityLabels);

/** `decisions.decision`. */
export const humanDecisionTypeCheck = inList(
  'decisions_decision_check',
  'decision',
  humanDecisionTypes,
);
