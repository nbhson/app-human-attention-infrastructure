import { describe, expect, it } from 'vitest';

import {
  ContextSourceType,
  createContextSnapshot,
  createContextSource,
  newContextID,
  newTaskID,
} from '@harness/domain';

import { renderContextPrompt } from '../render.js';

function snapshot(
  sources: { sourceId: string; content: string; relevance: number }[],
): ReturnType<typeof createContextSnapshot> {
  return createContextSnapshot({
    id: newContextID(),
    taskId: newTaskID(),
    sources: sources.map((s) =>
      createContextSource({
        type: ContextSourceType.File,
        sourceId: s.sourceId,
        relevanceScore: s.relevance,
        content: s.content,
        tokenCount: 1,
        contentHash: 'abc',
      }),
    ),
    totalTokens: 10,
    rankMethod: 'phase1-keyword-dependency',
    metadata: {
      taskDescription: 'Fix the payment bug',
      requirements: 'Do not touch the logging module',
    },
  });
}

describe('renderContextPrompt', () => {
  it('renders the three structured sections in order', () => {
    const prompt = renderContextPrompt(
      snapshot([
        {
          sourceId: 'src/PaymentService.ts',
          content: 'export class PaymentService {}',
          relevance: 0.9,
        },
      ]),
    );

    const project = prompt.indexOf('## Project Context');
    const task = prompt.indexOf('## Task');
    const files = prompt.indexOf('## Relevant Files (ranked, budgeted)');

    expect(project).toBeGreaterThanOrEqual(0);
    expect(task).toBeGreaterThan(project);
    expect(files).toBeGreaterThan(task);
  });

  it('includes the task description and requirements from snapshot metadata', () => {
    const prompt = renderContextPrompt(snapshot([]));

    expect(prompt).toContain('Fix the payment bug');
    expect(prompt).toContain('Do not touch the logging module');
  });

  it('lists every source with a language fence and its content', () => {
    const prompt = renderContextPrompt(
      snapshot([
        { sourceId: 'src/PaymentService.ts', content: 'export const pay = 1;', relevance: 0.9 },
        { sourceId: 'docs/README.md', content: '# Payment', relevance: 0.6 },
      ]),
    );

    expect(prompt).toContain('### src/PaymentService.ts');
    expect(prompt).toContain('```ts\nexport const pay = 1;\n```');
    expect(prompt).toContain('### docs/README.md');
    expect(prompt).toContain('```md');
  });

  it('uses a placeholder when the task description is missing', () => {
    const bare = createContextSnapshot({
      id: newContextID(),
      taskId: newTaskID(),
      sources: [],
      totalTokens: 0,
      rankMethod: 'phase1-keyword-dependency',
    });

    expect(renderContextPrompt(bare)).toContain('(no description)');
  });

  it('renders the injected review-memory section between Task and Relevant Files', () => {
    const withMemory = createContextSnapshot({
      id: newContextID(),
      taskId: newTaskID(),
      sources: [],
      totalTokens: 0,
      rankMethod: 'keyword',
      metadata: {
        taskDescription: 'Fix the payment bug',
        memory: [
          {
            id: 'mem-1',
            kind: 'DECISION',
            content: 'reject until verified',
            confidence: 80,
            relevance: 0.91,
          },
        ],
      },
    });

    const prompt = renderContextPrompt(withMemory);

    const task = prompt.indexOf('## Task');
    const memory = prompt.indexOf('## Review Memory');
    const files = prompt.indexOf('## Relevant Files (ranked, budgeted)');

    expect(memory).toBeGreaterThan(task);
    expect(files).toBeGreaterThan(memory);
    expect(prompt).toContain('- [DECISION] reject until verified (confidence: 80, relevance: 0.91)');
  });

  it('omits the memory section when none is injected (backward compatible)', () => {
    const prompt = renderContextPrompt(snapshot([]));
    expect(prompt).not.toContain('## Review Memory');
  });

  it('degrades a malformed memory section to empty rather than throwing', () => {
    const malformed = createContextSnapshot({
      id: newContextID(),
      taskId: newTaskID(),
      sources: [],
      totalTokens: 0,
      rankMethod: 'keyword',
      metadata: { memory: [{ id: 'x', kind: 'DECISION', content: 42 }] },
    });

    expect(() => renderContextPrompt(malformed)).not.toThrow();
    expect(renderContextPrompt(malformed)).not.toContain('## Review Memory');
  });
});
