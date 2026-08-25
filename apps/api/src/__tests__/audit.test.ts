import { describe, expect, it } from 'vitest';

import {
  mergeEntries,
  summarizeEvent,
  toEventEntry,
  toLlmEntry,
  toRunEntry,
  toToolEntry,
  type AuditEntry,
} from '../audit.js';

const iso = (ms: number): Date => new Date(ms);

describe('audit normalisation', () => {
  it('normalises a bus event with actor name and payload folded into detail', () => {
    const entry = toEventEntry({
      event_id: 'evt-1',
      event_type: 'review.report_created',
      event_version: 1,
      occurred_at: iso(1000),
      correlation_id: 'corr-1',
      actor_id: 'user-1',
      actor_name: 'Alice',
      payload: { pr_url: 'https://github.com/acme/api/pull/9', finding_count: 4 },
    });

    expect(entry).toEqual<AuditEntry>({
      id: 'evt-1',
      kind: 'event',
      occurredAt: '1970-01-01T00:00:01.000Z',
      correlationId: 'corr-1',
      actor: 'Alice',
      title: 'review.report_created',
      summary: 'pr_url=https://github.com/acme/api/pull/9 · finding_count=4',
      detail: {
        event_version: 1,
        pr_url: 'https://github.com/acme/api/pull/9',
        finding_count: 4,
      },
    });
  });

  it('falls back to a field count for an unlisted event type', () => {
    expect(summarizeEvent('task.created', { id: 'x', state: 'OPEN' })).toBe('2 field(s)');
  });

  it('normalises an LLM call with a token/stop summary', () => {
    const entry = toLlmEntry({
      id: 'llm-1',
      correlation_id: 'corr-1',
      model: 'claude-sonnet-4-6',
      input_tokens: 512,
      output_tokens: 80,
      stop_reason: 'end_turn',
      request_hash: 'abcd1234',
      created_at: iso(2000),
    });

    expect(entry.title).toBe('claude-sonnet-4-6');
    expect(entry.summary).toBe('512→80 tokens · end_turn');
    expect(entry.kind).toBe('llm');
  });

  it('normalises a tool step with its parent correlation', () => {
    const entry = toToolEntry({
      id: 'tool-1',
      correlation_id: 'corr-1',
      step_number: 3,
      thought: 'read the diff',
      tool_name: 'read_file',
      tool_input: { path: 'src/a.ts' },
      observation: 'const x = 1',
      created_at: iso(3000),
    });

    expect(entry.title).toBe('read_file');
    expect(entry.summary).toBe('read the diff');
    expect(entry.detail).toMatchObject({ step_number: 3 });
  });

  it('normalises a finished agent run with a computed duration', () => {
    const entry = toRunEntry({
      id: 'run-1',
      correlation_id: 'corr-1',
      attempt_number: 0,
      status: 'COMPLETED',
      started_at: iso(1000),
      finished_at: iso(3400),
      max_steps: 8,
      steps_used: 5,
      escalation_reason: null,
    });

    expect(entry.title).toBe('agent run · attempt 0');
    expect(entry.summary).toBe('COMPLETED · 5/8 steps · 2400ms');
    expect((entry.detail as { duration_ms: number }).duration_ms).toBe(2400);
  });
});

describe('mergeEntries', () => {
  it('merges sources newest-first and slices to the limit', () => {
    const events: AuditEntry[] = [
      {
        id: 'e1',
        kind: 'event',
        occurredAt: '1970-01-01T00:00:03.000Z',
        correlationId: null,
        actor: null,
        title: 't3',
        summary: '',
        detail: {},
      },
    ];
    const llms: AuditEntry[] = [
      {
        id: 'l1',
        kind: 'llm',
        occurredAt: '1970-01-01T00:00:05.000Z',
        correlationId: null,
        actor: null,
        title: 'm',
        summary: '',
        detail: {},
      },
      {
        id: 'l2',
        kind: 'llm',
        occurredAt: '1970-01-01T00:00:01.000Z',
        correlationId: null,
        actor: null,
        title: 'm',
        summary: '',
        detail: {},
      },
    ];

    const merged = mergeEntries([events, llms], 2);
    expect(merged.map((entry) => entry.id)).toEqual(['l1', 'e1']);
  });
});
