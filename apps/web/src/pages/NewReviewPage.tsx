import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers } from '../components/Icons';
import {
  ReviewsApiError,
  reviewsApi,
  type ReviewCreatedResult,
  type ReviewVerification,
  type ReviewVerificationStatus,
} from '../api/reviews';

/**
 * New AI Code Review (review-reorient Phase 3, redesigned) — the entry point of
 * the review workflow: enter the PR → submit the review → track it → open.
 *
 * The backend `POST /api/reviews` returns 202 immediately and processes the
 * review in a background worker. The report starts with a placeholder summary
 * ("⏳ Review is being processed...") and the report page polls until it's done.
 * This page shows the submission result and then polls the real report for the
 * sandbox verification (clone → build → test in Docker) as it moves PENDING →
 * RUNNING → a terminal state. That run is fire-and-forget and only *flags*,
 * never gates — the report page stays authoritative for detail.
 */

type Phase = 'form' | 'processing' | 'success' | 'error';

/** Sandbox-verification status → glanceable label + tone (mirrors VerificationTab). */
const VERIFICATION_TONE: Record<
  ReviewVerificationStatus,
  { readonly icon: string; readonly label: string; readonly color: string }
> = {
  PENDING: { icon: '◷', label: 'pending', color: 'var(--color-text-muted)' },
  RUNNING: { icon: '⟳', label: 'running', color: 'var(--color-info)' },
  PASSED: { icon: '✓', label: 'passed', color: 'var(--color-success)' },
  FAILED: { icon: '✕', label: 'failed', color: 'var(--color-danger)' },
  SKIPPED: { icon: '→', label: 'skipped', color: 'var(--color-warning)' },
  ERROR: { icon: '⚠', label: 'error', color: 'var(--color-danger)' },
};

/** One unified tone for the not-yet-started (null) and the real verification states. */
function describeVerification(verification: ReviewVerification | null): {
  readonly icon: string;
  readonly label: string;
  readonly color: string;
} {
  if (verification === null) {
    return { icon: '⟳', label: 'starting', color: 'var(--color-text-muted)' };
  }
  return VERIFICATION_TONE[verification.status];
}

/** Humanize a millisecond duration (or `—` when unknown). */
function humanDuration(ms: number | null): string {
  if (ms === null) {
    return '—';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Humanize the head SHA into a glanceable prefix (or `—` when unknown). */
function shortSha(sha: string | null): string {
  return sha === null ? '—' : sha.slice(0, 12);
}

/** How often to re-check the report while the background verification is in flight. */
const VERIFICATION_POLL_MS = 3_000;
/** Upper bound on re-checks — past this the user should open the report page. */
const VERIFICATION_POLL_ATTEMPTS = 20;

/** Terminal verification states — the poll stops once one of these is seen. */
function isVerificationTerminal(status: ReviewVerificationStatus): boolean {
  return status === 'PASSED' || status === 'FAILED' || status === 'SKIPPED' || status === 'ERROR';
}

/** Later steps could ask the server to co-validate; today GitHub PRs are the only
 *  supported target, so the client mirrors `parseGithubPrUrl`'s shape check. */
function validatePrUrl(value: string): string | null {
  if (value.trim().length === 0) {
    return null; // empty is its own state (button disabled + touched hint)
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "That's not a valid URL.";
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'The URL must use http(s).';
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const pullIndex = parts.indexOf('pull');
  const number = pullIndex === -1 ? Number.NaN : Number(parts[pullIndex + 1]);
  if (pullIndex === -1 || !Number.isInteger(number) || number <= 0) {
    return 'Paste the full pull request URL — it should end in /pull/123.';
  }
  return null;
}

/** Turn a thrown create error into a headline + detail the user can act on. */
function classifyError(error: unknown): { title: string; detail: string } {
  if (error instanceof ReviewsApiError) {
    if (error.status === 400) {
      return { title: "That's not a valid pull request URL.", detail: error.message };
    }
    if (error.status === 404) {
      return { title: 'Pull request not found.', detail: error.message };
    }
    if (error.status === 422) {
      return { title: 'The repository is not accessible.', detail: error.message };
    }
    if (error.status === 502 || error.status === 503) {
      return { title: 'The review service is unavailable.', detail: error.message };
    }
    if (error.status === 504) {
      return { title: 'The review timed out.', detail: error.message };
    }
    return { title: "The review couldn't be created.", detail: error.message };
  }
  return {
    title: "The review service couldn't be reached.",
    detail: 'Check your connection and try again.',
  };
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8.5 6.5 12 13 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function NewReviewPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('form');
  const [prUrl, setPrUrl] = useState('');
  const [jiraTicket, setJiraTicket] = useState('');
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<ReviewCreatedResult | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);
  const [verification, setVerification] = useState<ReviewVerification | null>(null);

  const prUrlError = validatePrUrl(prUrl);
  const showEmptyError = touched && prUrl.trim().length === 0;
  const canSubmit = prUrl.trim().length > 0 && prUrlError === null;
  const verificationView = describeVerification(verification);

  const create = useMutation({
    mutationFn: () =>
      reviewsApi.create({
        prUrl: prUrl.trim(),
        ...(jiraTicket.trim().length > 0 ? { jiraTicket: jiraTicket.trim() } : {}),
      }),
    onMutate: () => {
      setVerification(null);
      setPhase('processing');
    },
    onSuccess: (created) => {
      setResult(created);
      setPhase('success');
    },
    onError: (error: unknown) => {
      setFailure(classifyError(error));
      setPhase('error');
    },
  });

  // Once the report lands, watch the real sandbox verification (fire-and-forget)
  // until it reaches a terminal state, then stop. The status is read from the
  // stored report — nothing is invented; a report that never yields a verification
  // row stays on the neutral "starting" note rather than asserting a run.
  useEffect(() => {
    if (phase !== 'success' || result === null) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;

    const poll = async (): Promise<void> => {
      if (cancelled) {
        return;
      }
      let run: ReviewVerification | null | undefined;
      try {
        const report = await reviewsApi.getReport(result.reportId);
        run = report.verification;
      } catch {
        return; // a failed read leaves nothing honest to show here — the report page is authoritative
      }
      if (cancelled) {
        return;
      }
      if (run) {
        setVerification(run);
        if (isVerificationTerminal(run.status)) {
          return; // done — no further polling
        }
      }
      attempts += 1;
      if (attempts >= VERIFICATION_POLL_ATTEMPTS) {
        return;
      }
      timer = window.setTimeout(() => {
        void poll();
      }, VERIFICATION_POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [phase, result]);

  function onSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!canSubmit) {
      setTouched(true);
      return;
    }
    create.mutate();
  }

  function resetToForm(): void {
    setFailure(null);
    setVerification(null);
    setPhase('form');
  }

  return (
    <main className="create-page">
      <Link to="/review" className="back-link">
        <span aria-hidden="true">←</span> Review Queue
      </Link>

      <h1 className="create-title">New AI Code Review</h1>
      <p className="create-subtitle">
        Create an AI review for a pull request. HAI fetches the diff, analyzes the change, and returns findings with fix
        suggestions — it never writes code.
      </p>

      {phase === 'form' && (
        <form className="form-card" onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="prUrl" className="field-label">
              Pull request URL
              <span className="field-required" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="prUrl"
              className="field-input"
              value={prUrl}
              onChange={(event) => setPrUrl(event.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="https://github.com/acme/app/pull/123"
              inputMode="url"
              spellCheck={false}
              aria-invalid={showEmptyError || prUrlError !== null}
              aria-describedby={showEmptyError || prUrlError ? 'prUrl-message' : undefined}
            />
            {showEmptyError ? (
              <p id="prUrl-message" className="field-error" role="alert">
                Enter a pull request URL.
              </p>
            ) : prUrlError !== null ? (
              <p id="prUrl-message" className="field-error" role="alert">
                {prUrlError}
              </p>
            ) : (
              <p className="field-hint">Paste a GitHub pull request URL.</p>
            )}
          </div>

          <div className="field">
            <label htmlFor="jiraTicket" className="field-label">
              Jira ticket
              <span className="field-optional">Optional</span>
            </label>
            <input
              id="jiraTicket"
              className="field-input"
              value={jiraTicket}
              onChange={(event) => setJiraTicket(event.target.value)}
              placeholder="ACME-1234"
              spellCheck={false}
            />
            <p className="field-hint">Links the review to a ticket for requirement context.</p>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              Start Review
            </button>
            <span className="form-note">HAI only reads the diff — no code is changed.</span>
          </div>
        </form>
      )}

      {phase === 'processing' && (
        <div className="progress-panel" role="status" aria-live="polite">
          <h2 className="progress-title">Starting AI Review</h2>
          <p className="progress-subtitle">
            Your request has been submitted — HAI is fetching the pull request, running the AI review, and storing the
            report. This is a single request and can take a few minutes.
          </p>
          <div className="progress-indicator">
            <span className="spinner" aria-hidden="true" />
            <span>Review in progress…</span>
          </div>
        </div>
      )}

      {phase === 'success' && result !== null && (
        <div className="result-panel" role="status">
          <span className="result-icon">
            <CheckIcon />
          </span>
          <h2 className="result-title">Review submitted</h2>
          <p className="result-summary">
            HAI is reviewing your pull request in the background — this can take a few minutes. Open the report page to
            track progress.
          </p>

          <div className="verification-block">
            <div className="verification-block-head">
              <span className="verification-block-label">
                <Layers size={14} />
                Sandbox verification
              </span>
              <span
                data-testid="sandbox-status"
                className="verification-pill"
                style={{ color: verificationView.color, borderColor: verificationView.color }}
              >
                <span aria-hidden="true">{verificationView.icon}</span>
                {verificationView.label}
              </span>
            </div>

            {verification === null ? (
              <p className="verification-block-sub">
                The sandbox run starts in the background, right after the review is stored.
              </p>
            ) : (
              <>
                <div className="verification-block-meta">
                  <span>
                    overall <strong>{verification.overall ?? '—'}</strong>
                  </span>
                  <span>
                    head <code>{shortSha(verification.headSha)}</code>
                  </span>
                  <span>took {humanDuration(verification.durationMs)}</span>
                </div>
                {verification.error !== null && verification.error.length > 0 && (
                  <p
                    className={verification.status === 'ERROR' ? 'verification-block-error' : 'verification-block-sub'}
                  >
                    {verification.error}
                  </p>
                )}
              </>
            )}

            <p className="verification-block-note">A flag, not a gate — it never blocks your decision or write-back.</p>
          </div>

          <div className="result-actions">
            <Link to={`/reviews/${result.reportId}`} className="btn btn-primary">
              View Review <span aria-hidden="true">→</span>
            </Link>
            <Link to="/review" className="btn btn-ghost">
              Return to Review Queue
            </Link>
          </div>
        </div>
      )}

      {phase === 'error' && failure !== null && (
        <div className="error-panel" role="alert">
          <h2 className="error-title">{failure.title}</h2>
          <p className="error-detail">{failure.detail}</p>
          <div className="result-actions">
            <button type="button" className="btn btn-primary" onClick={resetToForm}>
              Try Again
            </button>
            <Link to="/review" className="btn btn-ghost">
              Return to Review Queue
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
