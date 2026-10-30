import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, RefreshCw } from '../Icons';

interface ReportLoadErrorProps {
  /** The fetch failure's message, when the error is a known `Error`. */
  message?: string | null;
  onRetry: () => void;
}

/** The report failed to load entirely (deleted, or service unreachable). */
export function ReportLoadError({ message, onRetry }: ReportLoadErrorProps): JSX.Element {
  return (
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: 16 }}>
      <div className="rq-empty" role="alert">
        <div className="rq-empty-icon">
          <AlertTriangle />
        </div>
        <h3 className="rq-empty-title">Couldn&rsquo;t load this review report</h3>
        <p className="rq-empty-text">
          {message ?? 'The report failed to load — it may have been deleted, or the review service is unreachable.'}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Link to="/review" className="rq-empty-reset">
            <ArrowLeft size={13} />
            Back to Queue
          </Link>
          <button type="button" className="rq-empty-reset" onClick={onRetry}>
            <RefreshCw size={13} />
            Retry
          </button>
        </div>
      </div>
    </main>
  );
}
