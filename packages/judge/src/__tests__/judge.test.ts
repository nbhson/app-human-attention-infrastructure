import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AiProviderType,
  ReviewSeverity,
  ReviewVerdict,
  createFixSuggestion,
  createReviewFinding,
  createReviewReport,
  newReviewReportID,
} from '@harness/domain';
import type {
  JudgeRun,
  JudgeRunStore,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ReviewReport,
} from '@harness/domain';

import { Judge } from '../judge.js';
import { RUBRIC_PROMPT_VERSION, buildRubricPrompt, parseJudgeOutput } from '../rubric.js';

/** A scriptable {@link LLMProvider} that replays canned responses and records requests. */
class ScriptedLLM implements LLMProvider {
  readonly calls: LLMRequest[] = [];
  constructor(private readonly script: LLMResponse[]) {}
  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.calls.push(request);
    const next = this.script.shift();
    if (!next) {
      throw new Error('ScriptedLLM: script exhausted');
    }
    return next;
  }
}

function textResponse(content: string): LLMResponse {
  return {
    content,
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: 'end_turn',
  };
}

/** An in-memory {@link JudgeRunStore} that records every run for assertion. */
class RecordingStore implements JudgeRunStore {
  readonly runs: JudgeRun[] = [];
  async record(run: JudgeRun): Promise<void> {
    this.runs.push(run);
  }
}

/** A known-good fixture report: two findings (one precise, one vague) + one fix. */
function fixtureReport(): ReviewReport {
  return createReviewReport({
    id: newReviewReportID(),
    prUrl: 'https://github.com/acme/api/pull/42',
    prTitle: 'Add widget endpoint',
    aiProvider: AiProviderType.Anthropic,
    model: 'claude-sonnet-4-6',
    summary: 'Adds /widget; the payload dereference needs a guard.',
    overallVerdict: ReviewVerdict.RequestChanges,
    findings: [
      createReviewFinding({
        severity: ReviewSeverity.Critical,
        file: 'src/widget.ts',
        line: 42,
        message: 'Missing null check on user input',
        suggestion: 'Guard against null before dereferencing the payload',
      }),
      createReviewFinding({
        severity: ReviewSeverity.Minor,
        file: 'README.md',
        message: 'Typo in the endpoint description',
      }),
    ],
    suggestions: [
      createFixSuggestion({
        file: 'src/widget.ts',
        proposed: 'if (payload == null) return;',
        rationale: 'Avoid a null dereference before persisting',
      }),
    ],
  });
}

const MODEL = 'claude-sonnet-4-6';

describe('Judge.judgeReport', () => {
  it('returns numeric scores parsed from a stubbed LLM and records an audited run', async () => {
    const llm = new ScriptedLLM([
      textResponse(
        JSON.stringify({
          severityAgreement: 0.9,
          routingAgreement: 0.8,
          evidenceSufficiency: 0.95,
          overall: 0.87,
          reasoning: 'severity and routing mostly agree; evidence is strong',
        }),
      ),
    ]);
    const store = new RecordingStore();
    const judge = new Judge(llm, store, MODEL);
    const report = fixtureReport();

    const scores = await judge.judgeReport(report);

    // Numeric contract: the four dimensions come back as numbers in [0,1].
    expect(scores).toEqual({
      severityAgreement: 0.9,
      routingAgreement: 0.8,
      evidenceSufficiency: 0.95,
      overall: 0.87,
    });

    // Every run is persisted with prompt version + model + scores + reasoning.
    expect(store.runs).toHaveLength(1);
    const run = store.runs[0];
    expect(run).toBeDefined();
    expect(run!.reportId).toBe(report.id);
    expect(run!.prUrl).toBe(report.prUrl);
    expect(run!.promptVersion).toBe(RUBRIC_PROMPT_VERSION);
    expect(run!.model).toBe(MODEL);
    expect(run!.scores).toEqual(scores);
    expect(run!.reasoning).toMatch(/severity and routing/);

    // The LLM call carries the versioned rubric + a review-scoped system prompt.
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.model).toBe(MODEL);
    expect(llm.calls[0]!.systemPrompt).toContain('review-quality judge');
    expect(llm.calls[0]!.messages[0]!.content).toContain('severityAgreement');
    expect(llm.calls[0]!.messages[0]!.content).toContain('Missing null check');
  });

  it('forwards the correlation id into the LLM request when provided', async () => {
    const llm = new ScriptedLLM([
      textResponse(
        '{"severityAgreement":1,"routingAgreement":1,"evidenceSufficiency":1,"overall":1,"reasoning":"clean"}',
      ),
    ]);
    const judge = new Judge(llm, new RecordingStore(), MODEL);

    await judge.judgeReport(fixtureReport(), { correlationId: 'task-123' });

    expect(llm.calls[0]!.correlation_id).toBe('task-123');
  });

  it('does not mutate the report when judging', async () => {
    const llm = new ScriptedLLM([
      textResponse(
        '{"severityAgreement":0.5,"routingAgreement":0.5,"evidenceSufficiency":0.5,"overall":0.5,"reasoning":"mid"}',
      ),
    ]);
    const judge = new Judge(llm, new RecordingStore(), MODEL);
    const report = fixtureReport();
    const before = JSON.stringify({
      verdict: report.overallVerdict,
      findings: report.findings.length,
      suggestions: report.suggestions.length,
    });

    await judge.judgeReport(report);

    const after = JSON.stringify({
      verdict: report.overallVerdict,
      findings: report.findings.length,
      suggestions: report.suggestions.length,
    });
    expect(after).toBe(before);
    // The judge's only write is its own run — it never touches review state.
  });
});

describe('parseJudgeOutput', () => {
  it('clamps out-of-range scores into [0,1]', () => {
    const parsed = parseJudgeOutput(
      '```json\n{"severityAgreement":1.5,"routingAgreement":-0.2,"evidenceSufficiency":0.5,"overall":0.55,"reasoning":"x"}\n```',
    );
    expect(parsed.scores.severityAgreement).toBe(1);
    expect(parsed.scores.routingAgreement).toBe(0);
  });

  it('throws when a dimension is missing', () => {
    expect(() => parseJudgeOutput('{"severityAgreement":0.5,"reasoning":"x"}')).toThrow(
      /missing dimension "routingAgreement"/,
    );
  });

  it('throws when the response is not JSON', () => {
    expect(() => parseJudgeOutput('not json at all')).toThrow(/no JSON object/);
  });
});

describe('buildRubricPrompt', () => {
  it('scopes to the report (findings + verdict), never the diff or author', () => {
    const prompt = buildRubricPrompt(fixtureReport());
    expect(prompt).toContain('REQUEST_CHANGES');
    expect(prompt).toContain('[CRITICAL] src/widget.ts:42');
    expect(prompt).toContain('severityAgreement');
    // No diff code or author attribution leaks into the judged artifact.
    expect(prompt).not.toContain('@@');
    expect(prompt).not.toContain('author');
  });
});

describe('@harness/judge boundary (day-21 §2.4)', () => {
  it('imports only @harness/domain (+ @harness/di) and nothing else', () => {
    const srcDir = dirname(fileURLToPath(import.meta.url));
    const allowed = ['@harness/domain', '@harness/di'];
    const files = ['index.ts', 'rubric.ts', 'judge.ts'];

    for (const file of files) {
      const source = readFileSync(join(srcDir, '..', file), 'utf8');
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1]!;
        if (specifier.startsWith('@harness/')) {
          expect(allowed, `${file} imports a forbidden @harness package: ${specifier}`).toContain(
            specifier,
          );
        }
      }
    }
  });
});
