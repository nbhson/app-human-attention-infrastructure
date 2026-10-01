/**
 * `ReviewVerificationService` (review-reorient Phase 3, wedge #1) — the "run the
 * real code" half of the moat. It turns each created review report into a
 * machine-side verification:
 *
 *   clone the PR at its head SHA → run the clone's own `build` then `test` in the
 *   Docker sandbox (sandbox-only, `network: none`, never the harness process) →
 *   persist an aggregated {@link VerificationFlag} + markdown render.
 *
 * Verification is deliberately **best-effort and fire-and-forget** — it runs in
 * the background after the report is stored, is on by default (opt out via
 * `VERIFY_REVIEW_ENABLED=0`), and is **never a gate**: a FAILED flag is information the
 * reviewer sees next to the findings, not a blocker on the human decision or on a
 * write-back. That is exactly the "flag, not gate" contract from
 * `@harness/verification-engine`.
 */

import { rm } from 'node:fs/promises';

import { eq } from 'drizzle-orm';

import { EventType, uuidv7 } from '@harness/domain';
import type { PullRequest, ReviewReportCreatedPayload, ReviewReportID } from '@harness/domain';
import { reviewReports, reviewVerifications } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';
import type { GitProvider } from '@harness/git-provider';
import { cloneInputFromPullRequest } from '@harness/git-provider';
import {
  CheckStatus,
  CloneVerifier,
  RequestTimeoutError,
  flagReport,
  renderFlag,
  withTimeout,
} from '@harness/verification-engine';
import type { CheckResult } from '@harness/verification-engine';

export interface ReviewVerificationDeps {
  readonly db: DrizzleDB;
  readonly bus: IEventBus;
  /** Null when no Git token is configured → the run is marked SKIPPED. */
  readonly gitProvider: GitProvider | null;
  readonly verifier: CloneVerifier;
  /** Env gate: verification runs by default; `VERIFY_REVIEW_ENABLED=0` opts out. */
  readonly enabled: boolean;
  readonly logger: Logger;
}

/** The sandbox root clones land in (mirrors `bootstrap.ts`'s `SANDBOX_ROOT`). */
function sandboxRoot(): string {
  return process.env.SANDBOX_ROOT ?? './sandbox';
}

/**
 * Clone+verify budget in seconds. Validated: a malformed
 * `VERIFY_CLONE_TIMEOUT_S` (NaN/0/negative) falls back to 600 instead of
 * poisoning `setTimeout` downstream.
 */
function cloneTimeoutSeconds(): number {
  const raw = Number(process.env.VERIFY_CLONE_TIMEOUT_S ?? '600');
  return Number.isFinite(raw) && raw > 0 ? raw : 600;
}

/**
 * A RUNNING row older than this is treated as orphaned (process died between
 * insert and terminal update) and may be re-run. Two per-check budgets plus
 * clone overhead and a 5-minute grace period.
 */
function staleRunningThresholdMs(): number {
  return cloneTimeoutSeconds() * 2 * 1000 + 300_000;
}

/** Total wall-clock budget for one `verifier.verify()` call (both checks + overhead). */
function verifyTotalTimeoutMs(): number {
  return cloneTimeoutSeconds() * 2 * 1000 + 60_000;
}

/**
 * Markdown for an all-SKIPPED run — nothing ran, so it must never read as
 * PASSED. Carries the per-check reason so a missing manifest
 * (`no build script declared`) is distinguishable from infra
 * (`sandbox unavailable: …`).
 */
function renderSkippedMarkdown(checks: readonly CheckResult[]): string {
  const rows = checks.map((check) => `- ${check.checkKind}: ${check.output}`).join('\n');
  return (
    '## Verification — SKIPPED\n\n' +
    '_No build/test checks ran — nothing was verified._\n' +
    (rows.length > 0 ? `\n${rows}\n` : '')
  );
}

/**
 * One-line error for an all-SKIPPED run. The old generic
 * `(undeclared or sandbox unavailable)` hid the layout-vs-Docker distinction;
 * joining the per-check outputs keeps it honest without bloating the row.
 */
function skippedReason(checks: readonly CheckResult[]): string {
  const parts = checks.map((check) => `${check.checkKind}: ${check.output.slice(0, 300)}`);
  return `no build/test scripts ran (${parts.join(' | ')})`;
}

export class ReviewVerificationService {
  constructor(private readonly deps: ReviewVerificationDeps) {}

  /** Subscribe to `review.report_created` and run verification in the background. */
  subscribe(): void {
    this.deps.bus.subscribe<ReviewReportCreatedPayload>(EventType.ReviewReportCreated, (event) => {
      void this.verify(event.payload.review_report_id).catch((error) => {
        this.deps.logger.error('review verification failed', {
          review_report_id: event.payload.review_report_id,
          error: String(error),
        });
      });
    });
  }

  /**
   * Clone + verify one report, updating its `review_verifications` row terminal
   * state. Idempotent per report: an existing row means the run is already done or
   * in flight, so this returns without re-cloning.
   */
  async verify(reportId: ReviewReportID): Promise<void> {
    const { db, gitProvider, verifier, enabled, logger } = this.deps;

    // P1 fix: check cheap gates BEFORE inserting RUNNING — avoids junk rows when
    // disabled / unconfigured, and keeps the table honest (no RUNNING→SKIPPED churn).
    if (!enabled) {
      await this.upsertSkipped(reportId, 'verification disabled (VERIFY_REVIEW_ENABLED=0 is set)');
      return;
    }
    if (!gitProvider) {
      await this.upsertSkipped(reportId, 'no Git provider configured (set GITHUB_TOKEN)');
      return;
    }

    const existing = await db
      .select({
        id: reviewVerifications.id,
        status: reviewVerifications.status,
        updated_at: reviewVerifications.updated_at,
      })
      .from(reviewVerifications)
      .where(eq(reviewVerifications.report_id, reportId))
      .limit(1);
    // Allow re-run from terminal ERROR/SKIPPED (retry path deletes rows anyway);
    // only skip when a run already succeeded/failed or is freshly in flight. A
    // stale RUNNING row (process died mid-run) is re-runnable so reports never
    // stay stuck at "running" forever.
    if (existing[0] && (existing[0].status === 'PASSED' || existing[0].status === 'FAILED')) {
      return; // one verification per report
    }
    if (existing[0]?.status === 'RUNNING') {
      const updatedAt = existing[0].updated_at instanceof Date ? existing[0].updated_at.getTime() : null;
      const ageMs = updatedAt === null ? 0 : Date.now() - updatedAt;
      if (ageMs < staleRunningThresholdMs()) {
        return; // genuinely in flight
      }
      logger.info('review verification stale RUNNING detected, re-running', {
        review_report_id: reportId,
        age_ms: ageMs,
      });
    }

    const rowId = existing[0]?.id ?? uuidv7();
    if (!existing[0]) {
      try {
        await db.insert(reviewVerifications).values({
          id: rowId,
          report_id: reportId,
          status: 'RUNNING',
        });
      } catch {
        return; // concurrent verify won the race (unique report_id)
      }
    } else {
      await db
        .update(reviewVerifications)
        .set({ status: 'RUNNING', error: null, updated_at: new Date() })
        .where(eq(reviewVerifications.id, rowId));
    }

    const report = await db
      .select()
      .from(reviewReports)
      .where(eq(reviewReports.id, reportId))
      .limit(1)
      .then((rows) => rows[0]);
    if (!report) {
      await this.markSkipped(rowId, 'review report not found');
      return;
    }

    // Validate the stored pr_payload shape before using it — the jsonb column
    // round-trips as `unknown` through Drizzle so we guard against corruption.
    const rawPayload = report.pr_payload;
    if (
      typeof rawPayload !== 'object' ||
      rawPayload === null ||
      !('provider' in rawPayload) ||
      !('number' in rawPayload) ||
      !('repo' in rawPayload) ||
      !('url' in rawPayload) ||
      !('files' in rawPayload)
    ) {
      await this.markError(rowId, 'review report has an invalid pr_payload shape');
      return;
    }
    const pr = rawPayload as PullRequest;
    // `cloneInputFromPullRequest` throws on an unusable head SHA (e.g. the
    // empty `head.sha` some forge mappers store). That throw used to escape
    // outside any try block, orphaning the row at RUNNING forever with no
    // workdir, no container, and no further DB write. A report with no usable
    // SHA has nothing to clone, so record an honest SKIPPED instead.
    let cloneInput: ReturnType<typeof cloneInputFromPullRequest>;
    try {
      cloneInput = cloneInputFromPullRequest(pr);
    } catch (error) {
      await this.markSkipped(rowId, `cannot verify: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const workdir = `${sandboxRoot()}/verify-${reportId}`;

    let clone;
    try {
      clone = await gitProvider.cloneAndCheckout(cloneInput, workdir);
    } catch (error) {
      await this.markError(rowId, `clone failed: ${String(error)}`);
      await this.cleanup(workdir);
      return;
    }

    try {
      const totalMs = verifyTotalTimeoutMs();
      const result = await withTimeout(verifier.verify(clone), totalMs, () => new RequestTimeoutError());
      const flag = flagReport(result.checks);
      // An honest distinction the flag alone collapses: "nothing failed" is not
      // necessarily "passed". If every check was SKIPPED (no declared build/test
      // script, or the sandbox was unavailable), nothing was actually verified.
      const allSkipped = result.checks.every((check) => check.status === CheckStatus.SKIPPED);
      const status = flag.failed ? 'FAILED' : allSkipped ? 'SKIPPED' : 'PASSED';
      // Nothing ran on an all-SKIPPED run, so "no overall verdict" — the honest read
      // is "skipped", never "passed by default".
      const overall = allSkipped ? null : flag.verdict;
      // `renderFlag` only serialises PASSED/FAILED, so an all-SKIPPED run would
      // otherwise render as "PASSED" while `status` says SKIPPED. Emit the honest
      // SKIPPED markdown instead.
      const rendered = allSkipped ? renderSkippedMarkdown(result.checks) : renderFlag(flag);

      await db
        .update(reviewVerifications)
        .set({
          status,
          overall,
          head_sha: result.headSha,
          content_hash: result.contentHash,
          duration_ms: result.durationMs,
          flag,
          rendered,
          error: allSkipped && !flag.failed ? skippedReason(result.checks) : null,
          updated_at: new Date(),
        })
        .where(eq(reviewVerifications.id, rowId));

      logger.info('review verification complete', {
        review_report_id: reportId,
        status,
        head_sha: result.headSha,
      });
    } catch (error) {
      if (error instanceof RequestTimeoutError) {
        await this.markError(
          rowId,
          `verify timed out after ${Math.round(verifyTotalTimeoutMs() / 1000)}s — the clone's build/test did not finish in budget (VERIFY_CLONE_TIMEOUT_S=${cloneTimeoutSeconds()})`,
        );
      } else {
        await this.markError(rowId, `verify failed: ${String(error)}`);
      }
    } finally {
      await this.cleanup(workdir);
    }
  }

  private async markSkipped(id: string, reason: string): Promise<void> {
    await this.deps.db
      .update(reviewVerifications)
      .set({ status: 'SKIPPED', error: reason, updated_at: new Date() })
      .where(eq(reviewVerifications.id, id));
  }

  /** P1 fix: insert-or-update a SKIPPED row without a prior RUNNING row. */
  private async upsertSkipped(reportId: ReviewReportID, reason: string): Promise<void> {
    const existing = await this.deps.db
      .select({ id: reviewVerifications.id })
      .from(reviewVerifications)
      .where(eq(reviewVerifications.report_id, reportId))
      .limit(1);
    if (existing[0]) {
      await this.markSkipped(existing[0].id, reason);
      return;
    }
    try {
      await this.deps.db.insert(reviewVerifications).values({
        id: uuidv7(),
        report_id: reportId,
        status: 'SKIPPED',
        error: reason,
      });
    } catch {
      // Lost the race — the winner already records the outcome.
    }
  }

  private async markError(id: string, reason: string): Promise<void> {
    await this.deps.db
      .update(reviewVerifications)
      .set({ status: 'ERROR', error: reason, updated_at: new Date() })
      .where(eq(reviewVerifications.id, id));
  }

  /** Remove the throwaway clone, best-effort — it is never needed after the run. */
  private async cleanup(workdir: string): Promise<void> {
    try {
      await rm(workdir, { recursive: true, force: true });
    } catch {
      // A left-behind clone dir is harmless; never surface cleanup failure.
    }
  }
}
