import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { provenanceApi } from '../api/provenance';
import { Timeline } from '../components/Timeline';

/**
 * Provenance page (day-26 §2.2) — the read-only "why did this task end up here?"
 * answer. Renders all seven chain sections (task, agent run, LLM calls,
 * trajectory, artifacts, verification, events) from the Day-17 read model, for a
 * COMPLETED or FAILED task alike.
 */
export default function ProvenancePage(): JSX.Element {
  const { id = '' } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['provenance', id],
    queryFn: () => provenanceApi.getChain(id),
    enabled: id !== '',
  });

  if (isLoading) {
    return <p>Loading provenance…</p>;
  }
  if (isError || !data || data.task === null) {
    return <p>Could not load provenance for task {id}.</p>;
  }

  const { task, agentRun, llmCalls, trajectory, artifacts, verification, events } = data;

  return (
    <main style={{ maxWidth: 920, margin: '0 auto', padding: 16 }}>
      <p>
        <Link to="/review">← Back to queue</Link>
      </p>

      <h2 style={{ marginBottom: 4 }}>{task.title}</h2>
      <p style={{ color: '#6e7781', marginTop: 0 }}>
        Task <code>{task.id}</code> · State: <strong>{task.state}</strong>
        {agentRun && ` · attempt ${agentRun.attemptNumber}`}
      </p>

      <section>
        <h3>Agent Run</h3>
        {agentRun ? (
          <p>
            <code>{agentRun.id}</code> — status <strong>{agentRun.status}</strong> · attempt{' '}
            {agentRun.attemptNumber}
          </p>
        ) : (
          <p>No agent run recorded.</p>
        )}
      </section>

      <section>
        <h3>LLM Calls ({llmCalls.length})</h3>
        {llmCalls.length === 0 && <p>No calls recorded.</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {llmCalls.map((call) => (
            <li key={call.id}>
              <code>{call.model}</code>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Trajectory ({trajectory.length} steps)</h3>
        {trajectory.length === 0 && <p>No steps recorded.</p>}
        <ol>
          {trajectory.map((step) => (
            <li key={step.id}>
              <span style={{ color: '#6e7781' }}>#{step.stepNumber}</span>{' '}
              {step.toolName ?? '(no tool)'}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3>Artifacts ({artifacts.length})</h3>
        {artifacts.length === 0 && <p>No artifacts.</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {artifacts.map((artifact) => (
            <li key={artifact.id}>
              <code>{artifact.filePath}</code>{' '}
              <span style={{ color: '#6e7781', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                sha256:{artifact.contentHash.slice(0, 8)}…
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Verification</h3>
        {verification.reports.length === 0 && <p>No verification report.</p>}
        {verification.reports.map((report) => (
          <p key={report.id}>
            Overall: <strong>{report.overall}</strong>
          </p>
        ))}
        {verification.checkResults.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {verification.checkResults.map((check) => (
              <li key={check.id}>
                <span>{check.status === 'PASSED' ? '✓' : '✗'}</span> {check.checkKind}:{' '}
                {check.status}
              </li>
            ))}
          </ul>
        )}
        <p style={{ color: '#6e7781', fontSize: '0.85rem' }}>
          Evidence ({verification.evidenceIds.length}):{' '}
          {verification.evidenceIds.map((evidenceId) => (
            <code key={evidenceId} style={{ marginRight: 6 }}>
              {evidenceId.slice(0, 8)}…
            </code>
          ))}
        </p>
      </section>

      <section>
        <h3>Events ({events.length})</h3>
        <Timeline events={events} />
      </section>
    </main>
  );
}
