/**
 * Observability unit tests (day-03 §2.5 / §3.3).
 *
 * The centralized sink is the only place real trace writes happen, so the span
 * semantics that every engine relies on are exercised here directly:
 *
 *  - `harness.correlation_id` is stamped on every span from the in-flight
 *    correlation context (or the one bound via `withSpan({ ctx })`);
 *  - a *root* span (no active parent) write-throughs exactly once on end;
 *  - a *child* span never write-throughs — the low-volume `trace_correlation`
 *    join stays a per-root-span insert, not a hot path;
 *  - `withSpan` nesting yields a correct parent/child lineage (shared trace_id,
 *    child.parentSpanId === parent.spanId).
 *
 * The tracer provider is global - once registered it cannot be re-registered to
 * a fresh sink without spans orphaning on the old one - so this file initializes
 * ONCE (beforeAll) and clears the in-memory sink between tests.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TraceCorrelationRow } from '../tracer.js';
import {
  currentCorrelation,
  endSpan,
  initTracing,
  inMemoryExporter,
  resetTracing,
  runWithCorrelation,
  startSpan,
  withSpan,
} from '../index.js';

/** The write-through target is swapped per test; the provider holds a delegator. */
let currentWriter: ((row: TraceCorrelationRow) => void) | undefined;

beforeAll(() => {
  // The tracer provider is global and worker-shared across test files — reset
  // first so this file owns the active provider and its delegating writer.
  resetTracing();
  initTracing({
    writeThrough: (row) => currentWriter?.(row),
  });
});

beforeEach(() => {
  currentWriter = undefined;
  inMemoryExporter().reset();
});

/** Helper: pull the finished span with `name` out of the in-memory sink. */
function finishedSpan(name: string) {
  const span = inMemoryExporter()
    .getFinishedSpans()
    .find((s) => s.name === name);
  if (!span) {
    throw new Error(`no finished span named "${name}"`);
  }
  return span;
}

describe('startSpan correlation stamping', () => {
  it('stamps harness.correlation_id from the ambient correlation context', () => {
    runWithCorrelation({ correlationId: 'ambient-1' }, () => {
      const span = startSpan('test.span');
      endSpan(span);
    });
    expect(finishedSpan('test.span').attributes['harness.correlation_id']).toBe('ambient-1');
  });

  it('defaults to the bootstrap correlation when no context is bound', () => {
    const span = startSpan('test.span');
    endSpan(span);
    expect(finishedSpan('test.span').attributes['harness.correlation_id']).toBe(
      currentCorrelation().correlationId,
    );
  });
});

describe('write-through (root span only)', () => {
  it('a root span writes through exactly once, with its correlation', () => {
    const write = vi.fn();
    currentWriter = write;
    runWithCorrelation({ correlationId: 'root-task-1' }, () => {
      const span = startSpan('root.span');
      endSpan(span);
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ correlation_id: 'root-task-1' }));
  });

  it('a child span never writes through — only the root does', async () => {
    const write = vi.fn();
    currentWriter = write;

    await withSpan({ spanName: 'outer.root' }, async () => {
      // A descendant span, started while the outer span is active.
      const child = startSpan('inner.child');
      endSpan(child);
    });

    expect(write).toHaveBeenCalledTimes(1); // outer.root only
    expect(finishedSpan('inner.child')).toBeDefined();
  });

  it('never throws when the writer fails (a trace write cannot break the pipeline)', () => {
    currentWriter = () => {
      throw new Error('db down');
    };
    const span = startSpan('resilient.span');
    expect(() => endSpan(span)).not.toThrow();
  });
});

describe('withSpan lineage', () => {
  it('nested spans form one trace and are guaranteed same-trace descendants', async () => {
    await withSpan({ spanName: 'parent', ctx: { correlationId: 'task-9' } }, async () => {
      await withSpan({ spanName: 'child' }, async () => {
        // no-op body; descendants share the parent's active context
      });
    });

    const parent = finishedSpan('parent');
    const child = finishedSpan('child');
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect(child.parentSpanId).toBe(parent.spanContext().spanId);
  });

  it('an explicit ctx wins over the ambient correlation', async () => {
    await runWithCorrelation({ correlationId: 'ambient' }, async () => {
      await withSpan({ spanName: 'bound', ctx: { correlationId: 'engine-task' } }, async () => {});
    });
    expect(finishedSpan('bound').attributes['harness.correlation_id']).toBe('engine-task');
  });
});
