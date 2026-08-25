import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { auditApi, type AuditEntry, type AuditKind } from '../api/audit';
import { Skeleton } from '../components/Skeleton';

/**
 * Global audit timeline page (day-34 §4.5) — a tab fully separate from the
 * three-screen review flow. It renders every operation the system recorded
 * (bus events, LLM/model calls, tool calls, agent runs) as one clickable
 * timeline, newest first, with a kind filter and full payload detail on click.
 */

const KINDS: readonly AuditKind[] = ['event', 'llm', 'tool', 'run'];

const KIND_LABEL: Record<AuditKind, string> = {
  event: 'Event',
  llm: 'LLM call',
  tool: 'Tool call',
  run: 'Agent run',
};

/** Colour token per kind (status palette, so dark mode follows automatically). */
const KIND_COLOR: Record<AuditKind, string> = {
  event: 'var(--color-info)',
  llm: 'var(--sev-critical)',
  tool: 'var(--color-warning)',
  run: 'var(--color-success)',
};

const PAGE_SIZE = 50;

function auditSkeleton(): JSX.Element {
  return (
    <main style={{ maxWidth: 920, margin: '0 auto', padding: 16 }}>
      <Skeleton width={160} height={20} />
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} height={48} />
        ))}
      </div>
    </main>
  );
}

/** Deconstructed detail panel for one entry. */
function Detail({ entry }: { readonly entry: AuditEntry }): JSX.Element {
  if (entry.kind === 'llm') {
    const d = entry.detail;
    return (
      <dl className="audit-detail">
        <dt>Model</dt>
        <dd>{String(d.model)}</dd>
        <dt>Tokens</dt>
        <dd>
          {String(d.input_tokens)} in → {String(d.output_tokens)} out
        </dd>
        <dt>Stop reason</dt>
        <dd>{String(d.stop_reason)}</dd>
        <dt>Request hash</dt>
        <dd>
          <code>{String(d.request_hash).slice(0, 16)}…</code>
        </dd>
      </dl>
    );
  }
  if (entry.kind === 'tool') {
    const d = entry.detail;
    return (
      <dl className="audit-detail">
        <dt>Tool</dt>
        <dd>{d.tool_name === null ? '(none)' : String(d.tool_name)}</dd>
        <dt>Step</dt>
        <dd>{String(d.step_number)}</dd>
        {d.thought !== null && (
          <>
            <dt>Thought</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{String(d.thought)}</dd>
          </>
        )}
        {d.tool_input !== undefined && (
          <>
            <dt>Input</dt>
            <dd>
              <pre className="audit-json">{JSON.stringify(d.tool_input, null, 2)}</pre>
            </dd>
          </>
        )}
        {d.observation !== null && (
          <>
            <dt>Observation</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{String(d.observation)}</dd>
          </>
        )}
      </dl>
    );
  }
  if (entry.kind === 'run') {
    const d = entry.detail;
    return (
      <dl className="audit-detail">
        <dt>Status</dt>
        <dd>{String(d.status)}</dd>
        <dt>Attempt</dt>
        <dd>{String(d.attempt_number)}</dd>
        <dt>Steps</dt>
        <dd>
          {String(d.steps_used)}/{String(d.max_steps)}
        </dd>
        <dt>Duration</dt>
        <dd>{d.duration_ms === null ? '(running/unknown)' : `${String(d.duration_ms)}ms`}</dd>
        {d.escalation_reason !== null && (
          <>
            <dt>Escalation</dt>
            <dd>{String(d.escalation_reason)}</dd>
          </>
        )}
      </dl>
    );
  }
  // event — show the full payload.
  return <pre className="audit-json">{JSON.stringify(entry.detail, null, 2)}</pre>;
}

export default function AuditPage(): JSX.Element {
  const [kind, setKind] = useState<AuditKind | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['audit', kind],
      queryFn: ({ pageParam }) =>
        auditApi.list({ kind: kind ?? undefined, limit: PAGE_SIZE, before: pageParam }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextBefore ?? undefined,
      refetchInterval: 5_000,
    });

  const items = (data?.pages ?? []).flatMap((page) => page.items);

  if (isLoading) {
    return auditSkeleton();
  }

  return (
    <main style={{ maxWidth: 920, margin: '0 auto', padding: 16 }}>
      <p style={{ margin: 0 }}>
        <Link to="/review">← Review queue</Link>
      </p>

      <h2 style={{ marginBottom: 4 }}>System activity</h2>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>
        Every operation the system recorded — events, LLM calls, tool calls, and agent runs — newest
        first. Click a row for the full payload.
      </p>

      <div
        role="group"
        aria-label="Filter by kind"
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}
      >
        <button
          type="button"
          aria-pressed={kind === null}
          onClick={() => setKind(null)}
          style={{
            padding: '3px 12px',
            borderRadius: '999px',
            border: `1px solid ${kind === null ? 'var(--color-info)' : 'var(--color-border)'}`,
            background: kind === null ? 'var(--color-info)' : 'var(--color-surface-2)',
            color: kind === null ? '#ffffff' : 'var(--color-text)',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          All
        </button>
        {KINDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            onClick={() => setKind(option)}
            style={{
              padding: '3px 12px',
              borderRadius: '999px',
              border: `1px solid ${kind === option ? KIND_COLOR[option] : 'var(--color-border)'}`,
              background: kind === option ? KIND_COLOR[option] : 'var(--color-surface-2)',
              color: kind === option ? '#ffffff' : 'var(--color-text)',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {KIND_LABEL[option]}
          </button>
        ))}
      </div>

      {isError && <p>Could not load the audit timeline.</p>}
      {!isError && items.length === 0 && <p>No activity recorded yet.</p>}

      {items.length > 0 && (
        <ol role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((entry) => {
            const isOpen = expanded === entry.id;
            return (
              <li
                key={entry.id}
                data-testid={`audit-entry-${entry.id}`}
                style={{ marginBottom: 8 }}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : entry.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    border: '1px solid var(--color-border)',
                    borderLeft: `4px solid ${KIND_COLOR[entry.kind]}`,
                    borderRadius: 'var(--radius)',
                    background: isOpen ? 'var(--color-surface)' : 'var(--color-surface-2)',
                    cursor: 'pointer',
                    color: 'var(--color-text)',
                  }}
                >
                  <span
                    style={{
                      minWidth: 150,
                      color: 'var(--color-text-faint)',
                      fontSize: '0.8rem',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {new Date(entry.occurredAt).toLocaleString()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, display: 'block' }}>{entry.title}</span>
                    <span
                      style={{
                        color: 'var(--color-text-muted)',
                        fontSize: '0.85rem',
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.actor !== null && <em>by {entry.actor}</em>}
                      {entry.actor !== null && ' · '}
                      {entry.summary}
                    </span>
                  </span>
                  <span
                    style={{
                      alignSelf: 'center',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      color: KIND_COLOR[entry.kind],
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {KIND_LABEL[entry.kind]}
                  </span>
                </button>

                {isOpen && (
                  <div
                    style={{
                      padding: 12,
                      border: '1px solid var(--color-border)',
                      borderTop: 'none',
                      borderRadius: '0 0 var(--radius) var(--radius)',
                      background: 'var(--color-surface)',
                    }}
                  >
                    <p
                      style={{
                        margin: '0 0 8px',
                        color: 'var(--color-text-faint)',
                        fontSize: '0.75rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}
                    >
                      correlation{' '}
                      <code>{entry.correlationId === null ? '(none)' : entry.correlationId}</code>
                    </p>
                    <Detail entry={entry} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {hasNextPage && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            style={{
              padding: '6px 16px',
              borderRadius: '999px',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </main>
  );
}
