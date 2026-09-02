import type { ReviewListSummary, ReviewsListItem } from '../api/reviews';
import { Activity, CheckCircle2, ShieldAlert, Sparkles, Zap } from './Icons';
import { useActivityPanel } from './SystemActivitySidebar';

/**
 * Queue header — title + amber-dot pending badge, the two header actions, and the
 * three metric cards. Metrics are derivable only: high-priority and critical-AST
 * counts come off the pending list, and the acceptance rate is `approved /
 * decided` from `GET /api/reviews/summary`.
 */

interface MetricProps {
  readonly icon: typeof ShieldAlert;
  readonly tone: 'amber' | 'red' | 'emerald';
  readonly value: string | number;
  readonly label: string;
}

function Metric({ icon: Icon, tone, value, label }: MetricProps): JSX.Element {
  return (
    <div className="rq-metric">
      <div className={`rq-metric-icon rq-metric-icon--${tone}`}>
        <Icon />
      </div>
      <div className="rq-metric-body">
        <div className="rq-metric-value">{value}</div>
        <div className="rq-metric-label">{label}</div>
      </div>
    </div>
  );
}

interface ReviewQueueHeaderProps {
  readonly reviews: readonly ReviewsListItem[];
  readonly pendingCount: number;
  readonly summary: ReviewListSummary | undefined;
  readonly isRefreshing: boolean;
  readonly onSync: () => void;
}

export function ReviewQueueHeader({
  reviews,
  pendingCount,
  summary,
  isRefreshing,
  onSync,
}: ReviewQueueHeaderProps): JSX.Element {
  const highPriority = reviews.filter((r) => r.priority === 'high').length;
  const criticalFindings = reviews.reduce((sum, r) => sum + r.criticalFindings, 0);
  const decided = summary?.decidedCount ?? 0;
  const approved = summary?.approvedCount ?? 0;
  const acceptance = decided > 0 ? `${Math.round((approved / decided) * 100)}%` : '—';
  const { isOpen: isActivityOpen, toggle: toggleActivityPanel } = useActivityPanel();

  return (
    <header className="rq-header">
      <div className="rq-header-row">
        <div className="rq-title-row">
          <h1 className="rq-title">Review Queue</h1>
          <span className="rq-pending" data-testid="queue-count">
            <span className="rq-pending-dot" aria-hidden="true" />
            {pendingCount} pending
          </span>
        </div>
        <div className="rq-header-actions">
          <button
            type="button"
            className={`rq-header-btn${isActivityOpen ? ' rq-header-btn--active' : ''}`}
            onClick={toggleActivityPanel}
            aria-pressed={isActivityOpen}
          >
            <Activity />
            <span>Activity Sidebar</span>
            <span className="rq-header-btn-dot" aria-hidden="true" />
          </button>
          <button type="button" className="rq-header-btn" onClick={onSync} disabled={isRefreshing}>
            <Sparkles className={isRefreshing ? 'rq-spin' : undefined} />
            <span>Sync AI Findings</span>
          </button>
        </div>
      </div>

      <p className="rq-subtitle">
        Reviews waiting for a human decision, prioritised by risk derived from the AI findings' severity and the
        change's blast radius.
      </p>

      <div className="rq-metrics">
        <Metric icon={ShieldAlert} tone="amber" value={highPriority} label="High Priority / Risk" />
        <Metric icon={Zap} tone="red" value={criticalFindings} label="Critical AST Issues" />
        <Metric icon={CheckCircle2} tone="emerald" value={acceptance} label="AI Acceptance Rate" />
      </div>
    </header>
  );
}
