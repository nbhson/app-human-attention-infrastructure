/**
 * `Judge` (day-21 §3.3) — the LLM-as-judge service.
 *
 * `judgeReport` renders the versioned rubric prompt for a {@link ReviewReport},
 * calls the {@link import('@harness/domain').LLMProvider} seam, parses the numeric
 * `JudgeScores`, and records the run through the {@link import('@harness/domain').JudgeRunStore}
 * seam. It **returns** the scores and writes an audit row; it never mutates the
 * report or a decision — the judge is a pure measurement, consumed later.
 */

import type { JudgeRunStore, JudgeScores, LLMProvider, ReviewReport } from '@harness/domain';
import { newJudgeRunID } from '@harness/domain';

import { canonicalReportHash } from './report-hash.js';
import { buildRubricPrompt, parseJudgeOutput, RUBRIC_PROMPT_VERSION, RUBRIC_SYSTEM_PROMPT } from './rubric.js';

/** Optional per-call overrides. */
export interface JudgeOptions {
  /** Task lifecycle id, forwarded to the LLM for `llm_call_log.correlation_id`. */
  readonly correlationId?: string;
  /** Sampling temperature the run was produced under (day-22 §2.2 provenance). */
  readonly temperature?: number;
}

export class Judge {
  constructor(
    private readonly llm: LLMProvider,
    private readonly store: JudgeRunStore,
    /** The concrete model id the judge calls (stamped onto each run). */
    private readonly model: string,
  ) {}

  async judgeReport(report: ReviewReport, opts: JudgeOptions = {}): Promise<JudgeScores> {
    const response = await this.llm.complete({
      model: this.model,
      messages: [{ role: 'user', content: buildRubricPrompt(report) }],
      maxTokens: 512,
      systemPrompt: RUBRIC_SYSTEM_PROMPT,
      ...(opts.correlationId !== undefined ? { correlation_id: opts.correlationId } : {}),
    });

    const { scores, reasoning } = parseJudgeOutput(response.content);

    await this.store.record({
      id: newJudgeRunID(),
      reportId: report.id,
      prUrl: report.prUrl,
      promptVersion: RUBRIC_PROMPT_VERSION,
      model: this.model,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      reportHash: canonicalReportHash(report),
      scores,
      reasoning,
      createdAt: new Date(),
    });

    return scores;
  }
}
