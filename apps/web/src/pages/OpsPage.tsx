import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { opsApi } from '../api/ops';

/**
 * Ops page — the operator surface over the otherwise API-only endpoints:
 * `GET /api/ops/health` (DB liveness), `GET /api/ops/metrics`
 * (task-state distribution, review-queue depth, orphan alarm), and
 * `GET /api/learning/cycles` (recent learning-loop outcomes).
 *
 * Read-only by design: no buttons here mutate anything — a stuck/orphaned
 * task is investigated via the review queue or a CLI runbook.
 */

function Card({
  label,
  value,
  sub,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
}): JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 16px',
        background: 'var(--color-surface)',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-faint)',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

export default function OpsPage(): JSX.Element {
  const health = useQuery({ queryKey: ['opsHealth'], queryFn: () => opsApi.health(), refetchInterval: 15_000 });
  const metrics = useQuery({ queryKey: ['opsMetrics'], queryFn: () => opsApi.metrics(), refetchInterval: 10_000 });
  const cycles = useQuery({ queryKey: ['learningCycles'], queryFn: () => opsApi.cycles(), refetchInterval: 15_000 });

  const states = metrics.data?.tasksByState ?? {};
  const stateEntries = Object.entries(states).sort((a, b) => b[1] - a[1]);
  const orphaned = metrics.data?.orphanedTasks ?? 0;

  return (
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: 16 }}>
      <p>
        <Link to="/review">← Back to queue</Link>
      </p>
      <h2 style={{ margin: '0 0 4px' }}>Ops &amp; Learning</h2>
      <p style={{ margin: '0 0 16px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
        Liveness, queue depth, stuck-task alarm, and recent learning-loop cycles. Read-only — the database is the
        dashboard.
      </p>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Card
          label="DB health"
          value={health.isLoading ? '…' : health.data?.ok === true ? 'OK' : 'DOWN'}
          sub={health.data ? `as of ${new Date(health.data.now).toLocaleString()}` : 'probing /api/ops/health'}
        />
        <Card
          label="Review queue depth"
          value={metrics.isLoading ? '…' : String(metrics.data?.reviewQueueDepth ?? 0)}
          sub="QUEUED rows awaiting attention"
        />
        <Card
          label="Orphaned tasks"
          value={metrics.isLoading ? '…' : String(orphaned)}
          sub="EXECUTING/VERIFYING > 10m — investigate, never auto-repair"
        />
      </section>

      {orphaned > 0 && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid var(--color-warning)',
            background: 'var(--color-warning-bg)',
            color: 'var(--color-warning)',
            fontSize: '0.85rem',
          }}
        >
          {orphaned} task{orphaned === 1 ? '' : 's'} stuck in-flight longer than 10 minutes. Check docker compose logs /
          psql — do not auto-repair rows.
        </div>
      )}

      <section style={{ marginTop: 20 }}>
        <h3 style={{ margin: '0 0 8px' }}>Tasks by state</h3>
        {metrics.isError && <p style={{ color: 'var(--color-danger)' }}>Could not load ops metrics.</p>}
        {!metrics.isError && stateEntries.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)' }}>{metrics.isLoading ? 'Loading…' : 'No tasks recorded.'}</p>
        )}
        {stateEntries.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {stateEntries.map(([state, count]) => (
              <li
                key={state}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface-2)',
                  fontSize: '0.85rem',
                }}
              >
                <code>{state}</code>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: 20 }}>
        <h3 style={{ margin: '0 0 8px' }}>Recent learning cycles</h3>
        {cycles.isLoading && <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>}
        {cycles.isError && <p style={{ color: 'var(--color-danger)' }}>Could not load learning cycles.</p>}
        {cycles.data && cycles.data.cycles.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)' }}>No completed loops recorded yet.</p>
        )}
        {cycles.data && cycles.data.cycles.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {cycles.data.cycles.map((cycle) => (
              <li
                key={cycle.cycle_id}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface-2)',
                  fontSize: '0.82rem',
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                }}
              >
                <code style={{ fontSize: '0.75rem' }}>{cycle.cycle_id.slice(0, 8)}…</code>
                <span>
                  outcome <strong>{cycle.outcome}</strong>
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {cycle.promoted ? 'promoted' : 'not promoted'} ·{' '}
                  {cycle.candidate_proposed ? 'candidate proposed' : 'no candidate'} · {cycle.sample_count} samples
                </span>
                <span style={{ marginLeft: 'auto', color: 'var(--color-text-faint)', fontSize: '0.75rem' }}>
                  {new Date(cycle.occurred_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p style={{ marginTop: 20, fontSize: '0.78rem', color: 'var(--color-text-faint)' }}>
        Raw Prometheus scrape stays at <code>/metrics</code> for Grafana — this page is the human glanceable subset.
      </p>
    </main>
  );
}
