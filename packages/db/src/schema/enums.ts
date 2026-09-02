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

export const artifactStatuses = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'MERGED'] as const;

export const changeStatuses = ['PENDING', 'VERIFIED', 'REVIEWED', 'ROLLED_BACK'] as const;

export const fileChangeTypes = ['CREATED', 'MODIFIED', 'DELETED', 'RENAMED'] as const;

export const verificationStatuses = ['RUNNING', 'PASSED', 'FAILED', 'ERROR', 'TIMEOUT', 'SKIPPED'] as const;

export const priorityLabels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/**
 * The priority bands the Day-13 adaptive-threshold controller may tune. MEDIUM
 * and LOW are fixed in v0, so only HIGH/CRITICAL are valid `band` values here.
 */
export const thresholdBands = ['HIGH', 'CRITICAL'] as const;

/** `review_queue.action` — the routing decision (attention spec §4). */
export const routingActions = ['REVIEW_REQUIRED', 'REVIEW_RECOMMENDED', 'AUTO_APPROVABLE', 'ESCALATE'] as const;

/** `review_queue.status` — the persistence-level queue state (attention spec §4). */
export const reviewQueueStatuses = ['QUEUED', 'CLAIMED', 'DECIDED', 'DROPPED', 'ESCALATED'] as const;

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
  // Day-14 (Phase 2): a machine decision, recorded with `actor_id IS NULL`.
  'AUTO_APPROVED',
] as const;

/**
 * Evidence record kinds (day-17 §2.1). Plain-text copies of the
 * engine-local `EvidenceKind` in `@harness/verification-engine` — `db` may not
 * import a sibling engine (boundary R4), so the lists live here, mirroring how
 * `checkStatuses` above tracks the engine's `CheckStatus`.
 */
export const evidenceKinds = [
  'CHECK_OUTPUT',
  'TEST_RESULTS',
  'SNAPSHOT',
  'LLM_TRANSCRIPT',
  'DIFF',
  'HUMAN_NOTE',
] as const;

/** What an evidence record is *linked to* via `evidence_links` (day-17 §2.1). */
export const evidenceSubjectKinds = ['check_result', 'artifact', 'report', 'agent_run'] as const;

/**
 * `context_source_embeddings.source_type` (day-16 §2.1) — the provenance
 * category of an embedded context source, mirroring `@harness/domain`'s
 * `ContextSourceType` (context-engine spec §2.2, §5.1).
 */
export const contextSourceTypes = [
  'FILE',
  'SYMBOL',
  'GIT_HISTORY',
  'DOCUMENTATION',
  'ARCHITECTURE',
  'TEST',
  'DECISION',
  'EVIDENCE',
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
export const fileChangeTypeCheck = inList('changes_change_type_check', 'change_type', fileChangeTypes);

/** `verification_results.status`. */
export const verificationStatusCheck = inList('verification_results_status_check', 'status', verificationStatuses);

/** `verification_check_results.status`. */
export const checkStatusCheck = inList('verification_check_results_status_check', 'status', checkStatuses);

/** `verification_test_results.status`. */
export const testResultStatusCheck = inList('verification_test_results_status_check', 'status', testResultStatuses);

/** `verification_reports.overall`. */
export const reportOverallCheck = inList('verification_reports_overall_check', 'overall', reportOverallStatuses);

/** `assessments.label`. */
export const priorityLabelCheck = inList('assessments_label_check', 'label', priorityLabels);

/** `attention_thresholds.band`. */
export const thresholdBandCheck = inList('attention_thresholds_band_check', 'band', thresholdBands);

/** `review_queue.action`. */
export const routingActionCheck = inList('review_queue_action_check', 'action', routingActions);

/** `review_queue.status`. */
export const reviewQueueStatusCheck = inList('review_queue_status_check', 'status', reviewQueueStatuses);

/** `decisions.decision`. */
export const humanDecisionTypeCheck = inList('decisions_decision_check', 'decision', humanDecisionTypes);

/** `evidence.kind`. */
export const evidenceKindCheck = inList('evidence_kind_check', 'kind', evidenceKinds);

/** `evidence_links.subject_kind`. */
export const evidenceSubjectKindCheck = inList(
  'evidence_links_subject_kind_check',
  'subject_kind',
  evidenceSubjectKinds,
);

/** `context_source_embeddings.source_type`. */
export const contextSourceTypeCheck = inList(
  'context_source_embeddings_source_type_check',
  'source_type',
  contextSourceTypes,
);

// --- Review-reorient (Phase 3) ---------------------------------------------
// Plain-text copies of the `@harness/domain` integration enums. Unlike the
// status machines above, most of these hold *lowercase* domain values (provider
// slugs), kept verbatim so raw SQL reads the same token the API accepts.

/** `review_reports.ai_provider` — the AI vendor slug. */
export const aiProviderTypes = ['openai', 'anthropic', 'gemini', 'opencode', 'custom'] as const;

/** `review_reports.overall_verdict` — the recommended verdict. */
export const reviewVerdicts = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const;

/** `review_findings.severity` — a finding severity band. */
export const reviewSeverities = ['CRITICAL', 'MAJOR', 'MINOR', 'NIT', 'INFO'] as const;

/** `review_findings.kind` — what to do about a finding: fix vs remove/simplify. */
export const findingKinds = ['correctness', 'cleanup'] as const;

/** `provider_configs.kind` — what a provider config configures. */
export const providerKinds = ['git', 'ticket', 'ai'] as const;

/** `writeback_log.action` — the external action performed. */
export const writebackActions = ['comment', 'status', 'label', 'transition'] as const;

/** `writeback_log.status` — a write-back attempt lifecycle (day-08 §2.1). */
export const writebackStatuses = ['PENDING', 'SUCCEEDED', 'FAILED', 'DUPLICATE'] as const;

/** `review_decisions.decision` — the human's verdict on a report (day-09 §2.2). */
export const reviewDecisionTypes = ['APPROVE', 'REQUEST_CHANGES', 'REJECT'] as const;

/** `review_verifications.status` — the review-slice verification lifecycle. */
export const reviewVerificationStatuses = ['PENDING', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED', 'ERROR'] as const;

/** `review_reports.ai_provider`. */
export const aiProviderCheck = inList('review_reports_ai_provider_check', 'ai_provider', aiProviderTypes);

/** `review_reports.overall_verdict`. */
export const reviewVerdictCheck = inList('review_reports_overall_verdict_check', 'overall_verdict', reviewVerdicts);

/** `review_findings.severity`. */
export const reviewSeverityCheck = inList('review_findings_severity_check', 'severity', reviewSeverities);

/** `review_findings.kind`. */
export const findingKindCheck = inList('review_findings_kind_check', 'kind', findingKinds);

/** `provider_configs.kind`. */
export const providerKindCheck = inList('provider_configs_kind_check', 'kind', providerKinds);

/** `writeback_log.action`. */
export const writebackActionCheck = inList('writeback_log_action_check', 'action', writebackActions);

/** `writeback_log.status`. */
export const writebackStatusCheck = inList('writeback_log_status_check', 'status', writebackStatuses);

/** `review_decisions.decision`. */
export const reviewDecisionTypeCheck = inList('review_decisions_decision_check', 'decision', reviewDecisionTypes);

/** `review_verifications.status`. */
export const reviewVerificationStatusCheck = inList(
  'review_verifications_status_check',
  'status',
  reviewVerificationStatuses,
);

// --- Day-16 (Phase 3) review memory ------------------------------------------
// The four review-shaped tiers (Spec 9 §3–§4), plain-text copies of the
// `@harness/domain` `MemoryKind` const object — kept here so drizzle-kit can
// evaluate the schema without an ESM workspace import (parity with the domain is
// enforced by the drift test in `enums.test.ts`).

/** `memory_entries.kind` — REVIEW / FINDING / DECISION / PROJECT. */
export const memoryKinds = ['REVIEW', 'FINDING', 'DECISION', 'PROJECT'] as const;

/** `memory_entries.status` — ACTIVE / ARCHIVED (day-19 §2.4). */
export const memoryStatuses = ['ACTIVE', 'ARCHIVED'] as const;

/** `memory_entries.kind`. */
export const memoryKindCheck = inList('memory_entries_kind_check', 'kind', memoryKinds);

/** `memory_entries.status`. */
export const memoryStatusCheck = inList('memory_entries_status_check', 'status', memoryStatuses);
