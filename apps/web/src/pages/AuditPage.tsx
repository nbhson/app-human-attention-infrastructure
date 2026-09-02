import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { auditApi, type AuditEntry, type AuditKind } from '../api/audit';
import { KIND_FILTERS, KIND_LABEL, kindClass, repoFromEntry, timeAgo } from '../components/auditMeta';
import { Activity, Radio, RefreshCw } from '../components/Icons';
import { Skeleton } from '../components/Skeleton';

/**
 * System Activity (day-34 §4.5 audit timeline, re-skinned as the reference
 * mockup's SystemActivityView) — a full-page telemetry feed over the whole
 * system's append-only trails (events + LLM calls + tool calls + agent runs),
 * newest first. A header with a refresh action, two live-health metric cards,
 * and a kind filter sit above the feed; clicking a row opens its full payload.
 *
 * The metric cards are derivable only, never invented: repository and token
 * counts are summed from the entries actually loaded in this stream.
 */

const PAGE_SIZE = 50;

/** Compact "12.4k"-style formatting for token totals. */
function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
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

function auditSkeleton(): JSX.Element {
  return (
    <div className="sa-content">
      <Skeleton width={260} height={24} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {Array.from({ length: 2 }).map((_, index) => (
          <Skeleton key={index} height={88} />
        ))}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} height={40} />
        ))}
      </div>
    </div>
  );
}

export default function AuditPage(): JSX.Element {
  const [kind, setKind] = useState<AuditKind | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, hasNextPage, fetchNextPage, isFetchingNextPage, refetch } =
    useInfiniteQuery({
      queryKey: ['audit', kind],
      queryFn: ({ pageParam }) => auditApi.list({ kind: kind ?? undefined, limit: PAGE_SIZE, before: pageParam }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextBefore ?? undefined,
      refetchInterval: 5_000,
    });

  const items = (data?.pages ?? []).flatMap((page) => page.items);

  const metrics = useMemo(() => {
    const repos = new Set<string>();
    let tokens = 0;
    for (const entry of items) {
      const repo = repoFromEntry(entry.detail);
      if (repo !== null) repos.add(repo);
      if (entry.kind === 'llm') {
        const input = typeof entry.detail.input_tokens === 'number' ? entry.detail.input_tokens : 0;
        const output = typeof entry.detail.output_tokens === 'number' ? entry.detail.output_tokens : 0;
        tokens += input + output;
      }
    }
    return { repos: repos.size, tokens };
  }, [items]);

  if (isLoading) {
    return auditSkeleton();
  }

  return (
    <div className="sa-content">
      <header className="sa-header">
        <div>
          <h1 className="sa-header-title">
            <Activity />
            System Activity &amp; AI Engine Telemetry
          </h1>
          <p className="sa-header-sub">
            Real-time event stream from webhooks, the AST analyzer, and triage heuristics.
          </p>
        </div>
        <button type="button" className="sa-refresh" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? 'rq-spin' : undefined} />
          <span>Refresh Telemetry</span>
        </button>
      </header>

      <div className="sa-metrics">
        <div className="sa-metric">
          <div className="sa-metric-head">
            <span className="sa-metric-label">Active Repositories</span>
            <span className="sa-metric-dot sa-metric-dot--blue" aria-hidden="true" />
          </div>
          <span className="sa-metric-value">{metrics.repos > 0 ? metrics.repos : '—'}</span>
          <span className="sa-metric-sub sa-metric-sub--blue">distinct repos in stream</span>
        </div>
        <div className="sa-metric">
          <div className="sa-metric-head">
            <span className="sa-metric-label">LLM Tokens</span>
            <span className="sa-metric-dot sa-metric-dot--purple" aria-hidden="true" />
          </div>
          <span className="sa-metric-value">{metrics.tokens > 0 ? formatCompact(metrics.tokens) : '—'}</span>
          <span className="sa-metric-sub sa-metric-sub--purple">consumed in this stream</span>
        </div>
      </div>

      <div className="sa-tabs" role="group" aria-label="Filter by kind">
        <span className="sa-tabs-label">Filter logs:</span>
        <button
          type="button"
          className={`sa-tab${kind === null ? ' sa-tab-active' : ''}`}
          aria-pressed={kind === null}
          onClick={() => setKind(null)}
        >
          all
        </button>
        {KIND_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            className={`sa-tab${kind === option ? ' sa-tab-active' : ''}`}
            aria-pressed={kind === option}
            onClick={() => setKind(option)}
          >
            {KIND_LABEL[option]}
          </button>
        ))}
      </div>

      {isError && (
        <div className="sa-empty" role="alert">
          <span className="sa-empty-icon" aria-hidden="true">
            <Radio />
          </span>
          <h3 className="sa-empty-title">Couldn&rsquo;t load the activity stream</h3>
          <p className="sa-empty-text">The telemetry endpoint is unreachable.</p>
        </div>
      )}

      {!isError && items.length === 0 && (
        <div className="sa-empty">
          <span className="sa-empty-icon" aria-hidden="true">
            <Radio />
          </span>
          <h3 className="sa-empty-title">No activity recorded yet</h3>
          <p className="sa-empty-text">
            Events, LLM calls, tool calls, and agent runs will appear here as the system works.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <ol role="list" className="sa-feed">
          {items.map((entry) => {
            const isOpen = expanded === entry.id;
            const repo = repoFromEntry(entry.detail);
            return (
              <li key={entry.id} style={{ listStyle: 'none' }}>
                <button
                  type="button"
                  className="sa-log"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : entry.id)}
                >
                  <span className="sa-log-left">
                    <span className="sa-log-time">{timeAgo(entry.occurredAt)}</span>
                    <span className={`sa-log-type ${kindClass(entry.kind)}`}>{KIND_LABEL[entry.kind]}</span>
                    <span className="sa-log-body">
                      <span className="sa-log-message">{entry.title}</span>
                      <span className="sa-log-summary">{entry.summary}</span>
                    </span>
                  </span>
                  {repo !== null && <span className="sa-log-repo">{repo}</span>}
                </button>

                {isOpen && (
                  <div className="sa-log-detail">
                    <p className="sa-log-detail-correlation">
                      correlation <code>{entry.correlationId === null ? '(none)' : entry.correlationId}</code>
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
        <div className="sa-loadolder">
          <button
            type="button"
            className="sa-loadolder-btn"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </div>
  );
}
