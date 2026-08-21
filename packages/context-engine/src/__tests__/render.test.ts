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
        tokenCount: Math.ceil(s.content.length / 4),
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
});
