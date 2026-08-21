/**
 * `VerificationEngine` (day-15 §2.2) — orchestrates the trust pipeline.
 *
 * `verify(changeId)` runs every registered check **in full, in parallel**
 * (Phase 1 strategy; Targeted/Incremental is deferred to Phase 3), under two
 * timeout levels:
 *
 *   - **level 1** per-check: each check raced against its own `timeoutMs`.
 *   - **level 2** request: the whole batch raced against `requestTimeoutMs`.
 *
 * The report is persisted to `verification_reports` + `verification_check_results`
 * and then `verification.completed` is published — the Day-14 `ChangeStatusSubscriber`
 * flips the change `PENDING → VERIFIED` on a PASSED verdict. The engine never
 * mutates `changes.status` itself: it is a *producer*, the subscriber is the
 * writer (day-14 §2.5).
 */

import { eq } from 'drizzle-orm';

import {
  brand,
  EventType,
  newVerificationRequestID,
  newVerificationResultID,
  uuidv7,
  VerificationStatus,
} from '@harness/domain';
import type { ChangeID, TaskID, VerificationCompletedPayload } from '@harness/domain';
import {
  agentRuns,
  changes,
  projects,
  tasks,
  verificationCheckResults,
  verificationReports,
  verificationTestResults,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';

import { readInt } from './env.js';
import { EvidenceKind, EvidenceStore, EvidenceSubjectKind } from './evidence-store.js';
import { CheckTimeoutError, RequestTimeoutError, withTimeout } from './timeout.js';
import type {
  CheckContext,
  CheckResult,
  OverallVerdict,
  VerificationCheck,
  VerificationReport,
} from './types.js';
import { CheckStatus } from './types.js';

/** Context resolved from the change, carrying the task/project the run belongs to. */
interface ResolvedContext extends CheckContext {
  readonly taskId: TaskID;
}

export interface VerificationEngineOptions {
  readonly checks: VerificationCheck[];
  /** Request-level timeout in ms (level 2), defaults to `VERIFY_REQUEST_TIMEOUT_MS`. */
  readonly requestTimeoutMs?: number;
  /** Where agent writes land (§5.5), defaults to `SANDBOX_ROOT` then `./sandbox`. */
  readonly sandboxRoot?: string;
}

export class VerificationEngine {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly options: VerificationEngineOptions,
    private readonly evidenceStore: EvidenceStore,
  ) {}

  private get requestTimeoutMs(): number {
    return this.options.requestTimeoutMs ?? readInt('VERIFY_REQUEST_TIMEOUT_MS', 120_000);
  }

  /** Verify one change; returns the persisted + published report. */
  async verify(changeId: ChangeID): Promise<VerificationReport> {
    const ctx = await this.buildContext(changeId);
    const started = Date.now();

    const runCheck = async (check: VerificationCheck): Promise<CheckResult> => {
      try {
        return await withTimeout(
          check.run(ctx),
          check.timeoutMs,
          () => new CheckTimeoutError(check.kind),
        );
      } catch (error) {
        if (error instanceof CheckTimeoutError) {
          return {
            checkKind: check.kind,
            status: CheckStatus.TIMED_OUT,
            durationMs: check.timeoutMs,
            output: error.message,
          };
        }
        // A throwing check must not fail the whole batch — it becomes FAILED.
        return {
          checkKind: check.kind,
          status: CheckStatus.FAILED,
          durationMs: 0,
          output: `check error: ${String(error)}`,
        };
      }
    };

    const checks = await withTimeout(
      Promise.all(this.options.checks.map(runCheck)),
      this.requestTimeoutMs,
      () => new RequestTimeoutError(),
    ).catch((error: unknown): CheckResult[] => {
      // Request-level timeout: every unfinished check is recorded TIMED_OUT so the
      // caller still gets a persisted + published report (day-15 §2.5 note).
      return this.options.checks.map((check) => ({
        checkKind: check.kind,
        status: CheckStatus.TIMED_OUT,
        durationMs: 0,
        output: error instanceof Error ? error.message : 'verification request timed out',
      }));
    });

    const report = buildReport(changeId, ctx.taskId, checks, Date.now() - started);
    await this.persist(report);
    this.publish(report);
    return report;
  }

  /** Resolve the change's task/project and derive its worktree path. */
  private async buildContext(changeId: ChangeID): Promise<ResolvedContext> {
    const rows = await this.db
      .select({
        taskId: tasks.id,
        repoPath: projects.repo_path,
      })
      .from(changes)
      .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id))
      .innerJoin(tasks, eq(tasks.id, agentRuns.task_id))
      .innerJoin(projects, eq(projects.id, tasks.project_id))
      .where(eq(changes.id, changeId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new Error(`verification context unresolved for change ${changeId}`);
    }
    return {
      changeId,
      taskId: brand(row.taskId, 'TaskID'),
      worktreePath: row.repoPath,
      sandboxRoot: this.options.sandboxRoot ?? process.env.SANDBOX_ROOT ?? './sandbox',
    };
  }

  private async persist(report: VerificationReport): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(verificationReports).values({
        id: report.id,
        change_id: report.changeId,
        task_id: report.taskId,
        overall: report.overall,
        duration_ms: report.durationMs,
        flaky: report.flaky,
      });
      for (const check of report.checks) {
        const checkResultId = uuidv7();
        // Day 17: full (uncapped) check output is stored as CHECK_OUTPUT evidence
        // first, then linked to this check-result row via `evidence_id`. The
        // inline `output` column stays capped; the evidence row holds the whole.
        const evidenceRecord = await this.evidenceStore.record(
          tx,
          EvidenceKind.CheckOutput,
          check.evidenceBody ?? check.output,
          [{ subjectKind: EvidenceSubjectKind.CheckResult, subjectId: checkResultId }],
        );
        await tx.insert(verificationCheckResults).values({
          id: checkResultId,
          report_id: report.id,
          check_kind: check.checkKind,
          status: check.status,
          duration_ms: check.durationMs,
          output: check.output,
          evidence_id: evidenceRecord.id,
        });
        // TEST checks also carry a structured TEST_RESULTS blob (their per-test
        // leaves, serialised) — a second evidence record linked to the same row.
        if ((check.testResults?.length ?? 0) > 0) {
          await this.evidenceStore.record(
            tx,
            EvidenceKind.TestResults,
            JSON.stringify(check.testResults),
            [{ subjectKind: EvidenceSubjectKind.CheckResult, subjectId: checkResultId }],
          );
        }
        // Day 16: TEST checks carry per-test leaves; persist one row per test,
        // linked to the check-result row just above (the FK §2.3 requires it).
        for (const test of check.testResults ?? []) {
          await tx.insert(verificationTestResults).values({
            id: uuidv7(),
            check_result_id: checkResultId,
            test_file: test.testFile,
            test_name: test.testName,
            status: test.status,
            duration_ms: test.durationMs,
            error: test.error ?? null,
            was_retried: check.retried ?? false,
          });
        }
      }
    });
  }

  private publish(report: VerificationReport): void {
    const payload: VerificationCompletedPayload = {
      request_id: newVerificationRequestID(),
      change_id: report.changeId,
      result_id: report.id,
      status: report.overall === 'PASSED' ? VerificationStatus.Passed : VerificationStatus.Failed,
      check_summaries: report.checks.map((check) => `${check.checkKind}: ${check.status}`),
    };
    this.bus.publish(
      createEvent(
        EventType.VerificationCompleted,
        brand(report.changeId, 'CorrelationID'),
        payload,
      ),
    );
  }
}

/**
 * Assemble a report (day-16 §2.2): PASSED iff every check is PASSED or FLAKY —
 * a flaky check counts as passed-but-flagged (`report.flaky = true`), never as a
 * silent failure. TIMED_OUT/SKIPPED/FAILED still fail the whole report, and only
 * those land in `failedChecks` (FLAKY is excluded so REWORK rationale is honest).
 */
function buildReport(
  changeId: ChangeID,
  taskId: TaskID,
  checks: CheckResult[],
  durationMs: number,
): VerificationReport {
  const flaky = checks.some((check) => check.status === CheckStatus.FLAKY);
  const overall: OverallVerdict = checks.every(
    (check) => check.status === CheckStatus.PASSED || check.status === CheckStatus.FLAKY,
  )
    ? 'PASSED'
    : 'FAILED';
  return {
    id: newVerificationResultID(),
    changeId,
    taskId,
    overall,
    durationMs,
    checks,
    flaky,
    failedChecks: checks
      .filter((check) => check.status !== CheckStatus.PASSED && check.status !== CheckStatus.FLAKY)
      .map((check) => check.checkKind),
  };
}
