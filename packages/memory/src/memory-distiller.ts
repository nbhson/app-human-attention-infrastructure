/**
 * `MemoryDistiller` (review-reorient Phase 3, day-17 §2.1) — deterministic
 * evidence → curated-memory extraction.
 *
 * The distiller turns stored review/decision rows into *candidate* memory
 * entries. It is deliberately a pure, deterministic map (no LLM, no I/O, no
 * `Date.now`) so the same evidence always yields the same candidates — the
 * memory pipeline must not fabricate, so it derives content from evidence fields
 * (findings, verdict, decision rationale), never from prose the resolver might
 * hallucinate. LLM *assistance* is a future opt-in behind `LLMProvider`; the
 * default is this extractor.
 */

import { HumanDecisionType } from '@harness/domain';
import type { ReviewDecisionType, ReviewSeverity, ReviewVerdict } from '@harness/domain';
import type { MemoryKind } from '@harness/domain';

/** A single problem the reviewer found, reduced to the fields the distiller reads. */
export interface ReviewFindingDistill {
  /** Stable finding id (stored in metadata for provenance). */
  readonly findingId: string;
  /** Severity band. */
  readonly severity: ReviewSeverity;
  /** Repo-relative file, when the finding is tied to one. */
  readonly file: string | null;
  /** What is wrong. */
  readonly message: string;
  /** Optional inline pointer at how to address it. */
  readonly suggestion: string | null;
}

/** A completed review, reduced to what a REVIEW/FINDING memory needs. */
export interface ReportDistillInput {
  /** The review-report id (event correlation). */
  readonly reportId: string;
  /** Web URL of the PR the report reviews (stable "same review" anchor). */
  readonly prUrl: string;
  /** The AI's executive summary. */
  readonly summary: string;
  /** The recommended verdict. */
  readonly verdict: ReviewVerdict;
  /** All findings, ordered severity-then-file. */
  readonly findings: readonly ReviewFindingDistill[];
}

/** A recorded human decision, reduced to what a DECISION memory needs. */
export interface DecisionDistillInput {
  /** The decision id (event correlation). */
  readonly decisionId: string;
  /** The change the decision targets (stable across an override). */
  readonly changeId: string | null;
  /** The decision made. */
  readonly decision: HumanDecisionType;
  /** The reason given, when the reviewer left one. */
  readonly rationale: string | null;
}

/**
 * A recorded review-slice decision, reduced to what a DECISION memory needs.
 * Distinct from {@link DecisionDistillInput}: the review slice keys its verdict
 * to a `review_report` (not a Phase-1 `change`), and its verdict vocabulary is
 * {@link ReviewDecisionType} (APPROVE / REQUEST_CHANGES / REJECT).
 */
export interface ReviewDecisionDistillInput {
  /** The decision id (event correlation). */
  readonly decisionId: string;
  /** The review report the decision targets (the stable topic). */
  readonly reportId: string;
  /** Web URL of the PR — a human-readable anchor, when the parent report is known. */
  readonly prUrl: string | null;
  /** The verdict recorded. */
  readonly decision: ReviewDecisionType;
  /** The reason given, when the reviewer left one. */
  readonly rationale: string | null;
}

/** A candidate memory entry — distinct from {@link MemoryEntry} in that it is not yet persisted. */
export interface DistilledMemory {
  readonly kind: MemoryKind;
  /** Stable "same idea" anchor; {@link import('./versioned-append.js').appendVersion} der keys on it. */
  readonly subject: string;
  /** Curated, human-readable summary — never the raw log/diff. */
  readonly content: string;
  /** Base confidence 0–99; recurrence bumps it, but never by fiat to 100 (day-17 §6). */
  readonly confidence: number;
  /** Kind-specific fields + provenance (report/finding/decision ids). */
  readonly metadata: Record<string, unknown>;
}

/**
 * Base confidence: conservative priors, deterministic per kind. Confidence is
 * *signal* — a starting belief that recurrence corroborates (day-17 §2.2) —
 * never a certainty.
 */
const REVIEW_BASE_CONFIDENCE = 50;
const DECISION_BASE_CONFIDENCE = 50;
const FINDING_SEVERITY_CONFIDENCE: Record<ReviewSeverity, number> = {
  CRITICAL: 90,
  MAJOR: 70,
  MINOR: 50,
  NIT: 30,
  INFO: 20,
};

/** Collapse case/whitespace/punctuation so minor wording shifts don't split a chain. */
function normalizeSubject(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export class MemoryDistiller {
  /**
   * A completed review → one `REVIEW` entry (the change + outcome) + one `FINDING`
   * entry per finding (the recurring-defect-pattern anchor is severity + the
   * normalized message, so the same defect re-found later versions onto itself).
   */
  distillReport(input: ReportDistillInput): DistilledMemory[] {
    const review: DistilledMemory = {
      kind: 'REVIEW',
      subject: `report:${input.prUrl}`,
      content: `Review of ${input.prUrl}\n\n${input.summary || '(no summary)'}\n\nVerdict: ${input.verdict}`,
      confidence: REVIEW_BASE_CONFIDENCE,
      metadata: {
        report_id: input.reportId,
        pr_url: input.prUrl,
        verdict: input.verdict,
        finding_count: input.findings.length,
      },
    };

    const findings: DistilledMemory[] = input.findings.map((finding) => {
      const message = normalizeSubject(finding.message);
      return {
        kind: 'FINDING',
        subject: `finding:${finding.severity}:${message}`,
        content:
          `${finding.severity}${finding.file ? ` in ${finding.file}` : ''}: ${finding.message}` +
          (finding.suggestion ? `\nSuggestion: ${finding.suggestion}` : ''),
        confidence: FINDING_SEVERITY_CONFIDENCE[finding.severity],
        metadata: {
          report_id: input.reportId,
          finding_id: finding.findingId,
          severity: finding.severity,
          file: finding.file,
        },
      };
    });

    return [review, ...findings];
  }

  /**
   * A recorded decision → one `DECISION` entry. `changeId` is the stable topic
   * (an override of the same change re-decides onto the prior entry), falling
   * back to the decision id when no change is linked.
   */
  distillDecision(input: DecisionDistillInput): DistilledMemory[] {
    const topic = input.changeId ?? input.decisionId;
    return [
      {
        kind: 'DECISION',
        subject: `decision:${topic}`,
        content:
          `Decision ${input.decision}${input.changeId ? ` on change ${input.changeId}` : ''}` +
          (input.rationale ? `:\n${input.rationale}` : ''),
        confidence: DECISION_BASE_CONFIDENCE,
        metadata: {
          decision_id: input.decisionId,
          change_id: input.changeId,
          decision: input.decision,
        },
      },
    ];
  }

  /**
   * A recorded review-slice decision → one `DECISION` entry. `reportId` is the
   * stable topic (re-deciding the same report versions onto the prior entry);
   * the `review:` prefix keeps it from ever colliding with a Phase-1
   * `decision:<changeId>` subject that happens to share the same UUID.
   */
  distillReviewDecision(input: ReviewDecisionDistillInput): DistilledMemory[] {
    return [
      {
        kind: 'DECISION',
        subject: `decision:review:${input.reportId}`,
        content:
          `Decision ${input.decision} on ${input.prUrl ?? `review ${input.reportId}`}` +
          (input.rationale ? `:\n${input.rationale}` : ''),
        confidence: DECISION_BASE_CONFIDENCE,
        metadata: {
          decision_id: input.decisionId,
          review_report_id: input.reportId,
          decision: input.decision,
        },
      },
    ];
  }
}
