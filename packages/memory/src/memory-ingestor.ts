/**
 * `MemoryIngestor` (review-reorient Phase 3, day-17 §2.3 §3.1 §3.4) — the
 * review/decision → memory ingestion pipeline.
 *
 * It subscribes to the review surface's *events* (`review.report_created`,
 * `review.decision_submitted`) and turns each into grounded memory: load the
 * backing db rows, materialize them into an `evidence` record (the proof the
 * memory rests on), distill candidate entries, and version-append each. The
 * event contract is the seam — this package reads `@harness/db` rows directly
 * and never imports `@harness/review` (day-17 §2.3, boundary R16).
 *
 * Handlers are fire-and-forget like every bus subscriber (the synchronous bus
 * catches nothing across an `await`), so each subscription catches + logs its
 * own async failure rather than letting a rejected promise vanish.
 */

import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { decisions, evidence, reviewFindings, reviewReports } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { EventType, newEvidenceID } from '@harness/domain';
import type {
  DecisionSubmittedPayload,
  EvidenceID,
  HumanDecisionType,
  ReviewReportCreatedPayload,
  ReviewSeverity,
  ReviewVerdict,
} from '@harness/domain';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';

import { MemoryDistiller } from './memory-distiller.js';
import type { DecisionDistillInput, ReviewFindingDistill } from './memory-distiller.js';
import { MemoryStore } from './memory-store.js';
import { appendVersion } from './versioned-append.js';

/** `evidence.kind` for a materialized review report (it *is* the LLM's output). */
const REPORT_EVIDENCE_KIND = 'LLM_TRANSCRIPT';
/** `evidence.kind` for a materialized human decision (the reviewer's note). */
const DECISION_EVIDENCE_KIND = 'HUMAN_NOTE';

/** SHA-256 of a body, hex — the content-hashed identity evidence requires. */
function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export class MemoryIngestor {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly store: MemoryStore,
    private readonly distiller: MemoryDistiller = new MemoryDistiller(),
    private readonly logger?: Logger,
  ) {}

  /** Register the two ingestion subscriptions (fire-and-forget handlers). */
  subscribe(): void {
    this.bus.subscribe<ReviewReportCreatedPayload>(EventType.ReviewReportCreated, (event) => {
      void this.ingestReport(event.payload).catch((error) => {
        this.logger?.error('memory: ingest report failed', {
          review_report_id: event.payload.review_report_id,
          error: String(error),
        });
      });
    });

    this.bus.subscribe<DecisionSubmittedPayload>(EventType.DecisionSubmitted, (event) => {
      void this.ingestDecision(event.payload).catch((error) => {
        this.logger?.error('memory: ingest decision failed', {
          decision_id: event.payload.decision_id,
          error: String(error),
        });
      });
    });
  }

  /**
   * A created review report → one `REVIEW` + one `FINDING` per finding. Each
   * entry cites a single materialized evidence record (the report + findings),
   * so every memory row keeps the ≥1-evidence invariant without re-reading it.
   */
  async ingestReport(payload: ReviewReportCreatedPayload): Promise<void> {
    const report = await this.db
      .select()
      .from(reviewReports)
      .where(eq(reviewReports.id, payload.review_report_id))
      .limit(1)
      .then((rows) => rows[0]);
    if (!report) {
      return; // nothing grounded to distill
    }

    const findingRows = await this.db
      .select()
      .from(reviewFindings)
      .where(eq(reviewFindings.report_id, payload.review_report_id))
      .orderBy(reviewFindings.order_index);

    const findings: ReviewFindingDistill[] = findingRows.map((row) => ({
      findingId: row.id,
      severity: row.severity as ReviewSeverity,
      file: row.file,
      message: row.message,
      suggestion: row.suggestion,
    }));

    const evidenceId = await this.recordEvidence(
      REPORT_EVIDENCE_KIND,
      JSON.stringify(
        {
          kind: 'review_report',
          report_id: report.id,
          pr_url: report.pr_url,
          verdict: report.overall_verdict,
          summary: report.summary,
          findings,
        },
        null,
        2,
      ),
    );

    for (const candidate of this.distiller.distillReport({
      reportId: report.id,
      prUrl: report.pr_url,
      summary: report.summary,
      verdict: report.overall_verdict as ReviewVerdict,
      findings,
    })) {
      await appendVersion(this.store, candidate, [evidenceId]);
    }
  }

  /** A submitted decision → one `DECISION` entry, grounded in the decision row. */
  async ingestDecision(payload: DecisionSubmittedPayload): Promise<void> {
    const decision = await this.db
      .select()
      .from(decisions)
      .where(eq(decisions.id, payload.decision_id))
      .limit(1)
      .then((rows) => rows[0]);
    if (!decision) {
      return;
    }

    const evidenceId = await this.recordEvidence(
      DECISION_EVIDENCE_KIND,
      JSON.stringify(
        {
          kind: 'review_decision',
          decision_id: decision.id,
          change_id: decision.change_id,
          decision: decision.decision,
          rationale: decision.rationale,
        },
        null,
        2,
      ),
    );

    const input: DecisionDistillInput = {
      decisionId: decision.id,
      changeId: decision.change_id,
      decision: decision.decision as HumanDecisionType,
      rationale: decision.rationale,
    };
    for (const candidate of this.distiller.distillDecision(input)) {
      await appendVersion(this.store, candidate, [evidenceId]);
    }
  }

  /** Write one content-hashed evidence row and return its id (the memory's proof). */
  private async recordEvidence(kind: string, body: string): Promise<EvidenceID> {
    const id = newEvidenceID();
    await this.db.insert(evidence).values({
      id,
      content_hash: sha256Hex(body),
      kind,
      body,
    });
    return id;
  }
}
