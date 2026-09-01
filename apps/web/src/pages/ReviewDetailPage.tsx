import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ReviewApiError, reviewApi, type DecisionChoice } from '../api/review';
import { DiffViewer } from '../components/DiffViewer';
import { EvidenceModal } from '../components/EvidenceModal';
import { FactorBreakdown } from '../components/FactorBreakdown';
import { LabelBadge } from '../components/LabelBadge';

/**
 * Review detail page (day-23 §2.3) — "why" panel, verification panel with
 * evidence links, structured-patch diff view, and the approve/reject decision
 * form. Read-thin: every field is rendered from the Day-22 payload.
 */
export default function ReviewDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [evidenceId, setEvidenceId] = useState<string | null>(null);

  const [decision, setDecision] = useState<DecisionChoice | null>(null);
  const [rationale, setRationale] = useState('');
  const [wasUseful, setWasUseful] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reviewDetail', id],
    queryFn: () => reviewApi.getDetail(id),
    enabled: id !== '',
  });

  const claim = useMutation({
    mutationFn: () => reviewApi.claim(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviewDetail', id] }),
    onError: (error: unknown) => {
      if (error instanceof ReviewApiError && error.status === 409) {
        setSubmitError('Someone else claimed this item — reloading.');
        void queryClient.invalidateQueries({ queryKey: ['reviewDetail', id] });
      }
    },
  });

  const decide = useMutation({
    mutationFn: () =>
      reviewApi.decide(id, {
        decision: decision as DecisionChoice,
        rationale,
        wasUseful: wasUseful as boolean,
        ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviewDetail', id] }),
    onError: (error: unknown) => {
      setSubmitError(error instanceof Error ? error.message : 'Decision failed.');
    },
  });

  // Spec 8 §2.4 actions beyond decide (day-24 scaffold): release re-queues a
  // claim; escalate hands the item to a higher authority with the rationale
  // field's text as the required reason.
  const release = useMutation({
    mutationFn: () => reviewApi.release(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviewDetail', id] }),
    onError: (error: unknown) => {
      setSubmitError(error instanceof Error ? error.message : 'Release failed.');
    },
  });

  const escalate = useMutation({
    mutationFn: () => reviewApi.escalate(id, rationale),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviewDetail', id] }),
    onError: (error: unknown) => {
      setSubmitError(error instanceof Error ? error.message : 'Escalate failed.');
    },
  });

  if (isLoading) {
    return <p>Loading item…</p>;
  }
  if (isError || !data) {
    return <p>Could not load this queue item.</p>;
  }

  const canSubmit =
    decision !== null && rationale.trim() !== '' && wasUseful !== null && !decide.isPending;
  const claimed = data.status === 'CLAIMED';

  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: 16 }}>
      <p>
        <Link to="/review">← Back to queue</Link>
      </p>
      {submitError && (
        <div
          role="alert"
          style={{
            background: 'var(--color-warning-bg)',
            color: 'var(--color-warning)',
            padding: 8,
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          {submitError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <section>
          <h3 style={{ marginTop: 0 }}>Why this item</h3>
          <p>
            <LabelBadge label={data.label} /> <strong>{data.combinedPriority.toFixed(2)}</strong>
          </p>
          <p>
            Rule: <code>{data.ruleId}</code> (policy v{data.policyVersion})
          </p>
          <p>Task: {data.taskTitle}</p>
          <p>State: {data.taskState}</p>
          <h4>Factors</h4>
          <FactorBreakdown factors={data.factors} />
        </section>

        <section>
          <h3 style={{ marginTop: 0 }}>Verification</h3>
          {data.checks.length === 0 && <p>No verification checks.</p>}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {data.checks.map((check, index) => (
              <li key={`${check.kind}-${index}`} style={{ marginBottom: 4 }}>
                <span>{check.status === 'PASSED' ? '✓' : '✗'}</span> {check.kind}: {check.status}
                {check.evidenceId !== null && (
                  <button
                    type="button"
                    style={{ marginLeft: 8 }}
                    onClick={() => setEvidenceId(check.evidenceId)}
                  >
                    evidence
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <h3>Diffs</h3>
        <DiffViewer diffs={data.diffs} />
      </section>

      <section
        style={{ borderTop: '1px solid var(--color-border)', marginTop: 16, paddingTop: 16 }}
      >
        {!claimed ? (
          <button type="button" onClick={() => claim.mutate()} disabled={claim.isPending}>
            Claim
          </button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) {
                void decide.mutate();
              }
            }}
          >
            <h3>Decision</h3>
            <label>
              <input
                type="radio"
                name="decision"
                value="APPROVE"
                checked={decision === 'APPROVE'}
                onChange={() => setDecision('APPROVE')}
              />{' '}
              Approve
            </label>
            <label style={{ marginLeft: 16 }}>
              <input
                type="radio"
                name="decision"
                value="REJECT"
                checked={decision === 'REJECT'}
                onChange={() => setDecision('REJECT')}
              />{' '}
              Reject
            </label>

            <div style={{ marginTop: 8 }}>
              <label>
                Rationale:{' '}
                <textarea
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                  rows={3}
                  style={{ width: '100%' }}
                />
              </label>
            </div>

            <div style={{ marginTop: 8 }}>
              <span>Was this item worth your attention?</span>{' '}
              <label>
                <input
                  type="radio"
                  name="wasUseful"
                  checked={wasUseful === true}
                  onChange={() => setWasUseful(true)}
                />{' '}
                yes
              </label>{' '}
              <label>
                <input
                  type="radio"
                  name="wasUseful"
                  checked={wasUseful === false}
                  onChange={() => setWasUseful(false)}
                />{' '}
                no
              </label>
            </div>

            <div style={{ marginTop: 8 }}>
              <label>
                Comment (optional):{' '}
                <input
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  style={{ width: '100%' }}
                />
              </label>
            </div>

            <button type="submit" disabled={!canSubmit} style={{ marginTop: 8 }}>
              Submit
            </button>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" onClick={() => release.mutate()} disabled={release.isPending}>
                Release
              </button>
              <button
                type="button"
                onClick={() => escalate.mutate()}
                disabled={escalate.isPending || rationale.trim() === ''}
              >
                Escalate
              </button>
            </div>
          </form>
        )}

        {data.decision && (
          <p style={{ marginTop: 8 }}>
            Decided: <strong>{data.decision.decision}</strong> by {data.decision.reviewerId}
            {data.decision.rationale && ` — ${data.decision.rationale}`}
          </p>
        )}
      </section>

      {evidenceId !== null && (
        <EvidenceModal evidenceId={evidenceId} onClose={() => setEvidenceId(null)} />
      )}
    </main>
  );
}
