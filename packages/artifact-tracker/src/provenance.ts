/**
 * `buildProvenanceChain` (day-17 §2.4) — the read-only query that assembles a
 * task's full causal trail: task → agent runs → LLM calls → trajectory steps →
 * artifacts (with content hashes) → verification (reports, check results,
 * evidence ids) → correlating events.
 *
 * Kept in `artifact-tracker` because it primarily reads tracker tables; boundary
 * rule R4 permits reading *other packages' tables through `@harness/db` (the rule
 * governs code imports between engines, and a provenance read-model is a
 * consumer, not a peer). It returns its own `TrackedProvenanceChain` type rather
 * than the domain `ProvenanceChain` (day-02), which targets a different,
 * UI-shaped read-model; this one exposes the raw sections the Day-26 provenance
 * UI and Day-27 audit queries need.
 *
 * Read-heavy at Phase-1 scale (a handful of sequential queries) — no cache until
 * Day-27 observability proves one is needed (§6).
 */

import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  agentRuns,
  artifacts,
  changes,
  eventLog,
  evidenceLinks,
  llmCallLog,
  tasks,
  trajectorySteps,
  verificationCheckResults,
  verificationReports,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { TaskID } from '@harness/domain';

/** `evidence_links.subject_kind` value binding evidence to a check result. */
const CHECK_RESULT_SUBJECT_KIND = 'check_result';

export interface ProvenanceTaskSection {
  readonly id: string;
  readonly title: string;
  readonly state: string;
}

export interface ProvenanceAgentRunSection {
  readonly id: string;
  readonly status: string;
  readonly attemptNumber: number;
}

export interface ProvenanceLlmCall {
  readonly id: string;
  readonly model: string;
}

export interface ProvenanceTrajectoryStep {
  readonly id: string;
  readonly stepNumber: number;
  readonly toolName: string | null;
}

export interface ProvenanceArtifact {
  readonly id: string;
  readonly filePath: string;
  /** SHA-256 of the artifact's latest change (its current content). */
  readonly contentHash: string;
}

export interface ProvenanceVerification {
  readonly reports: ReadonlyArray<{ readonly id: string; readonly overall: string }>;
  readonly checkResults: ReadonlyArray<{
    readonly id: string;
    readonly checkKind: string;
    readonly status: string;
  }>;
  readonly evidenceIds: readonly string[];
}

export interface ProvenanceEvent {
  readonly eventId: string;
  readonly eventType: string;
}

/** The seven sections of a task's provenance (day-17 §2.4). */
export interface TrackedProvenanceChain {
  readonly task: ProvenanceTaskSection | null;
  /** The latest (highest attempt number) agent run for the task. */
  readonly agentRun: ProvenanceAgentRunSection | null;
  readonly llmCalls: readonly ProvenanceLlmCall[];
  readonly trajectory: readonly ProvenanceTrajectoryStep[];
  readonly artifacts: readonly ProvenanceArtifact[];
  readonly verification: ProvenanceVerification;
  readonly events: readonly ProvenanceEvent[];
}

/**
 * Assemble the full provenance of one task. Every section is populated for a
 * task that has gone through an agent run; a task with no runs yields only
 * `task` populated and the rest empty.
 */
export async function buildProvenanceChain(
  db: DrizzleDB,
  taskId: TaskID,
): Promise<TrackedProvenanceChain> {
  const taskRows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const taskRow = taskRows[0];

  const runRows = await db.select().from(agentRuns).where(eq(agentRuns.task_id, taskId));
  const runIds = runRows.map((run) => run.id);
  const latestRun = runRows.reduce<(typeof runRows)[number] | undefined>((latest, run) => {
    return run.attempt_number >= (latest?.attempt_number ?? -1) ? run : latest;
  }, undefined);

  // Rows keyed on the task's agent runs. Guarded: `inArray(…, [])` is invalid SQL.
  let llmCalls: readonly ProvenanceLlmCall[] = [];
  let trajectory: readonly ProvenanceTrajectoryStep[] = [];
  let changeRows: { id: string; artifact_id: string; content_hash: string; created_at: Date }[] =
    [];
  if (runIds.length > 0) {
    llmCalls = await db
      .select({ id: llmCallLog.id, model: llmCallLog.model })
      .from(llmCallLog)
      .where(inArray(llmCallLog.agent_run_id, runIds));

    trajectory = await db
      .select({
        id: trajectorySteps.id,
        stepNumber: trajectorySteps.step_number,
        toolName: trajectorySteps.tool_name,
      })
      .from(trajectorySteps)
      .where(inArray(trajectorySteps.agent_run_id, runIds))
      .orderBy(asc(trajectorySteps.step_number));

    changeRows = await db
      .select({
        id: changes.id,
        artifact_id: changes.artifact_id,
        content_hash: changes.content_hash,
        created_at: changes.created_at,
      })
      .from(changes)
      .where(inArray(changes.agent_run_id, runIds));
  }
  const changeIds = changeRows.map((change) => change.id);

  const artifactsSection = await loadArtifacts(db, changeRows);

  const verificationSection = await loadVerification(db, changeIds);

  // The causal event trail joins on every correlation channel a task's events
  // use: the task id (state changes), its run ids (artifact.created), and its
  // change ids (verification.completed).
  const correlationKeys: readonly string[] = [taskId, ...runIds, ...changeIds];
  let events: readonly ProvenanceEvent[] = [];
  if (correlationKeys.length > 0) {
    events = await db
      .select({ eventId: eventLog.event_id, eventType: eventLog.event_type })
      .from(eventLog)
      .where(inArray(eventLog.correlation_id, correlationKeys))
      .orderBy(asc(eventLog.occurred_at));
  }

  return {
    task: taskRow ? { id: taskRow.id, title: taskRow.title, state: taskRow.state } : null,
    agentRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          attemptNumber: latestRun.attempt_number,
        }
      : null,
    llmCalls,
    trajectory,
    artifacts: artifactsSection,
    verification: verificationSection,
    events,
  };
}

/**
 * One entry per artifact touched by the task's runs, carrying the content hash
 * of its latest change (the write that produced its current bytes).
 */
async function loadArtifacts(
  db: DrizzleDB,
  changeRows: { id: string; artifact_id: string; content_hash: string; created_at: Date }[],
): Promise<readonly ProvenanceArtifact[]> {
  if (changeRows.length === 0) {
    return [];
  }
  const artifactIds = [...new Set(changeRows.map((change) => change.artifact_id))];

  const artifactRows = await db
    .select({ id: artifacts.id, filePath: artifacts.file_path })
    .from(artifacts)
    .where(inArray(artifacts.id, artifactIds));

  // Latest change per artifact (most recent `created_at` first).
  const latestHash = new Map<string, string>();
  const sorted = [...changeRows].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  for (const change of sorted) {
    if (!latestHash.has(change.artifact_id)) {
      latestHash.set(change.artifact_id, change.content_hash);
    }
  }

  return artifactRows.map((artifact) => ({
    id: artifact.id,
    filePath: artifact.filePath,
    contentHash: latestHash.get(artifact.id) ?? '',
  }));
}

/**
 * The verification trail: reports over the task's changes, their check results,
 * and the evidence ids linked to those check results (both `CHECK_OUTPUT` and
 * `TEST_RESULTS` evidence are bound to their check result via `evidence_links`).
 */
async function loadVerification(
  db: DrizzleDB,
  changeIds: readonly string[],
): Promise<ProvenanceVerification> {
  if (changeIds.length === 0) {
    return { reports: [], checkResults: [], evidenceIds: [] };
  }
  const reports = await db
    .select({ id: verificationReports.id, overall: verificationReports.overall })
    .from(verificationReports)
    .where(inArray(verificationReports.change_id, changeIds));
  const reportIds = reports.map((report) => report.id);

  let checkResults: ProvenanceVerification['checkResults'] = [];
  let evidenceIds: readonly string[] = [];
  if (reportIds.length > 0) {
    checkResults = await db
      .select({
        id: verificationCheckResults.id,
        checkKind: verificationCheckResults.check_kind,
        status: verificationCheckResults.status,
      })
      .from(verificationCheckResults)
      .where(inArray(verificationCheckResults.report_id, reportIds));

    const checkResultIds = checkResults.map((check) => check.id);
    if (checkResultIds.length > 0) {
      const links = await db
        .select({ evidenceId: evidenceLinks.evidence_id })
        .from(evidenceLinks)
        .where(
          and(
            eq(evidenceLinks.subject_kind, CHECK_RESULT_SUBJECT_KIND),
            inArray(evidenceLinks.subject_id, checkResultIds),
          ),
        );
      evidenceIds = [...new Set(links.map((link) => link.evidenceId))];
    }
  }

  return { reports, checkResults, evidenceIds };
}
