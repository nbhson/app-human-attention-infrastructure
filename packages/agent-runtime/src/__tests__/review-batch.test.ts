import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PullRequestFile, PullRequestFileStatus } from '@harness/domain';

import type { LLMProvider } from '../llm/llm-provider.js';
import { MockLLM } from '../llm/mock-llm.js';
import { OpenAICompatibleError } from '../llm/openai-compatible-provider.js';
import { ReviewParseError } from '../review/parse-review.js';
import { ReviewAgent } from '../review/review-agent.js';
import type { ReviewAgentOptions } from '../review/review-agent.js';
import { batchReview } from '../review/review-batch.js';
import type { BatchReviewOptions } from '../review/review-batch.js';
import type { ReviewPromptInput } from '../review/review-prompt.js';
import type { ReviewAgentOutput } from '../review/review-output.js';

/** A ReviewAgent whose `review` behaves per a script of callables. */
class ScriptedAgent extends ReviewAgent {
  private readonly script: Array<() => ReviewAgentOutput | Promise<ReviewAgentOutput>>;
  public readonly calls: Array<{ input: ReviewPromptInput; opts: ReviewAgentOptions }> = [];
  public attempts = 0;

  constructor(script: Array<() => ReviewAgentOutput | Promise<ReviewAgentOutput>>) {
    // The wrapped provider is never used — every call short-circuits in `review`.
    super(new MockLLM([]) as LLMProvider);
    this.script = script;
  }

  override async review(input: ReviewPromptInput, opts: ReviewAgentOptions): Promise<ReviewAgentOutput> {
    this.calls.push({ input, opts });
    const next = this.script[this.attempts];
    this.attempts += 1;
    if (next === undefined) {
      throw new Error(`ScriptedAgent: script exhausted after ${this.attempts} calls`);
    }
    return next();
  }
}

function file(path: string): PullRequestFile {
  return {
    path,
    status: 'MODIFIED' as PullRequestFileStatus,
    additions: 5,
    deletions: 1,
    patch: '@@ -1 +1 @@\n-old\n+new\n',
  };
}

function output(filePath: string): ReviewAgentOutput {
  return {
    summary: `review of ${filePath}`,
    overallVerdict: 'COMMENT',
    findings: [{ severity: 'MAJOR', kind: 'correctness', file: filePath, line: 2, message: `issue in ${filePath}` }],
    suggestions: [],
  };
}

const OPTS: BatchReviewOptions = {
  prUrl: 'https://github.com/acme/app/pull/7',
  prTitle: 'title',
  requirement: 'req',
  model: 'agnes-2.5-flash',
  correlationId: 'corr-1',
  // Force one file per batch so multi-file tests exercise the multi-batch path
  // (the tiny fixture patches would otherwise all fit into a single batch).
  maxBatchSize: 1,
};

describe('batchReview resilience', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('retries a transient JSON parse failure and succeeds (no skip)', async () => {
    const agent = new ScriptedAgent([
      () => {
        throw new ReviewParseError('AI review output was not valid JSON');
      },
      () => {
        throw new ReviewParseError('AI review output was not valid JSON');
      },
      () => output('src/a.ts'),
    ]);
    const failures: unknown[] = [];

    const promise = batchReview(agent, [file('src/a.ts')], {
      ...OPTS,
      onBatchFailure: (index, attempts, error) => failures.push({ index, attempts, error }),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(result.findings[0]?.file).toBe('src/a.ts');
    expect(agent.attempts).toBe(3); // initial + 2 backoff retries
    expect(failures).toHaveLength(0);
  });

  it('keeps a lone failed batch honest: the single batch still throws', async () => {
    const agent = new ScriptedAgent([
      () => {
        throw new ReviewParseError('AI review output was not valid JSON');
      },
      () => {
        throw new ReviewParseError('AI review output was not valid JSON');
      },
      () => {
        throw new ReviewParseError('AI review output was not valid JSON');
      },
    ]);

    const promise = batchReview(agent, [file('src/a.ts')], OPTS);
    // Attach a handler immediately so the mid-flush rejection isn't flagged as
    // unhandled before advanceTimersByTimeAsync yields.
    const captured = promise.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(captured).resolves.toBeInstanceOf(ReviewParseError);
    expect(agent.attempts).toBe(3); // exhausted retries
  });

  it('skips a permanently-failing batch in a multi-batch review and keeps the rest', async () => {
    // Plain Errors are non-transient → no sleep/retry, fail fast.
    const agent = new ScriptedAgent([
      () => output('src/a.ts'),
      () => {
        throw new Error('401 unauthorized');
      },
    ]);
    const failures: Array<{ index: number; attempts: number }> = [];

    const result = await batchReview(agent, [file('src/a.ts'), file('src/b.ts')], {
      ...OPTS,
      onBatchFailure: (index, attempts) => failures.push({ index, attempts }),
    });

    expect(result.findings.map((f) => f.file).sort()).toEqual(['src/a.ts']);
    expect(failures).toHaveLength(1);
    // Whichever of the two concurrent workers drew the `401` script entry gets
    // skipped — but it's always fast (non-transient, no backoff).
    expect(failures[0]?.attempts).toBe(1);
    expect([0, 1]).toContain(failures[0]?.index);
  });

  it('retries a provider 429 per batch and completes the review', async () => {
    const agent = new ScriptedAgent([
      () => output('src/a.ts'),
      () => {
        throw new OpenAICompatibleError(
          'openai-compatible https://x/v1/chat/completions failed: 429 — rate limit',
          'http',
        );
      },
      () => output('src/b.ts'),
    ]);
    const failures: unknown[] = [];

    const promise = batchReview(agent, [file('src/a.ts'), file('src/b.ts')], {
      ...OPTS,
      onBatchFailure: (index, attempts, error) => failures.push({ index, attempts, error }),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    // Whatever order the two concurrent batches resolved in, the 429'd batch
    // recovered on a retry and both findings are present.
    expect(result.findings.map((f) => f.file).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(failures).toHaveLength(0);
    expect(agent.attempts).toBe(3); // one batch used a backoff retry
  });

  it('fails the review when every batch is skipped after retries', async () => {
    const agent = new ScriptedAgent([
      () => {
        throw new Error('400 bad request');
      },
      () => {
        throw new Error('400 bad request');
      },
    ]);
    const failures: Array<{ index: number }> = [];

    await expect(
      batchReview(agent, [file('src/a.ts'), file('src/b.ts')], {
        ...OPTS,
        onBatchFailure: (index) => failures.push({ index }),
      }),
    ).rejects.toThrow(/every batch was skipped/);

    expect(failures.map((f) => f.index).sort()).toEqual([0, 1]);
  });
});
