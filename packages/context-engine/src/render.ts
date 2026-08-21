/**
 * Structured prompt rendering (day-21 §2.2) — turn a resolved snapshot into the
 * three-section system-prompt block the Agent Runtime consumes.
 *
 * Pure and deterministic: no LLM, no I/O. The snapshots's token budget is
 * already enforced at trim time, so rendering here only lays the sources out in
 * rank order; it never adds unbounded content.
 */

import type { ContextSnapshot, ContextSourceType } from '@harness/domain';

const SECTION_PROJECT = '## Project Context';
const SECTION_TASK = '## Task';
const SECTION_FILES = '## Relevant Files (ranked, budgeted)';

/** The static Phase-1 project-context rule (day-21 §2.2). */
const PROJECT_CONTEXT_RULE = '[architecture rules — Phase 1: static CONVENTIONS.md if present]';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Best-effort language fence for a source, keyed off its path extension. Phase 1
 * sources are `FILE` entries only, so a simple extension map is enough and avoids
 * a syntax-highlighting dependency.
 */
function fenceFor(sourceType: ContextSourceType, sourceId: string): string {
  void sourceType;
  const ext = sourceId.slice(sourceId.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') return 'ts';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'md';
  if (ext === 'py') return 'python';
  return '';
}

/**
 * Render a snapshot into the Agent Runtime's structured prompt. The task
 * description and requirements are read back out of the snapshot metadata (the
 * engine stores them there during `resolveContext`), so the renderer needs only
 * the snapshot itself.
 */
export function renderContextPrompt(snapshot: ContextSnapshot): string {
  const taskDescription = asString(snapshot.metadata.taskDescription);
  const requirements = asString(snapshot.metadata.requirements);

  const lines: string[] = [];
  lines.push(SECTION_PROJECT);
  lines.push(PROJECT_CONTEXT_RULE);
  lines.push('');

  lines.push(SECTION_TASK);
  lines.push(taskDescription.length > 0 ? taskDescription : '(no description)');
  if (requirements.length > 0) {
    lines.push('');
    lines.push(requirements);
  }
  lines.push('');

  lines.push(SECTION_FILES);
  for (const source of snapshot.sources) {
    lines.push(`### ${source.sourceId} (relevance: ${source.relevanceScore.toFixed(2)})`);
    const fence = fenceFor(source.type, source.sourceId);
    lines.push(fence.length > 0 ? `\`\`\`${fence}` : '```');
    lines.push(source.content);
    lines.push('```');
  }

  return lines.join('\n');
}
