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
import { CheckStatus, CloneVerifier, flagReport, renderFlag } from '@harness/verification-engine';

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

    const existing = await db
      .select({ id: reviewVerifications.id })
      .from(reviewVerifications)
      .where(eq(reviewVerifications.report_id, reportId))
      .limit(1);
    if (existing[0]) {
      return; // one verification per report
    }

    const rowId = uuidv7();
    await db.insert(reviewVerifications).values({
      id: rowId,
      report_id: reportId,
      status: 'RUNNING',
    });

    if (!enabled) {
      await this.markSkipped(rowId, 'verification disabled (VERIFY_REVIEW_ENABLED=0 is set)');
      return;
    }
    if (!gitProvider) {
      await this.markSkipped(rowId, 'no Git provider configured (set GITHUB_TOKEN)');
      return;
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

    const pr = report.pr_payload as PullRequest;
    const cloneInput = cloneInputFromPullRequest(pr);
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
      const result = await verifier.verify(clone);
      const flag = flagReport(result.checks);
      const rendered = renderFlag(flag);
      // An honest distinction the flag alone collapses: "nothing failed" is not
      // necessarily "passed". If every check was SKIPPED (no declared build/test
      // script, or the sandbox was unavailable), nothing was actually verified.
      const allSkipped = result.checks.every((check) => check.status === CheckStatus.SKIPPED);
      const status = flag.failed ? 'FAILED' : allSkipped ? 'SKIPPED' : 'PASSED';
      // Nothing ran on an all-SKIPPED run, so "no overall verdict" — the honest read
      // is "skipped", never "passed by default".
      const overall = allSkipped ? null : flag.verdict;

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
          error:
            allSkipped && !flag.failed
              ? 'no build/test scripts ran (undeclared or sandbox unavailable)'
              : null,
          updated_at: new Date(),
        })
        .where(eq(reviewVerifications.id, rowId));

      logger.info('review verification complete', {
        review_report_id: reportId,
        status,
        head_sha: result.headSha,
      });
    } catch (error) {
      await this.markError(rowId, `verify failed: ${String(error)}`);
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
