import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { PriorityLevel, ReviewDecision, ReviewsListItem } from '../api/reviews';
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitBranch,
  MessageSquare,
  ShieldAlert,
  Sliders,
  Square,
  X,
} from './Icons';

/**
 * A single queue row, in either detailed (the default) or compact form. The
 * detailed card mirrors the mockup: a left verdict strip, checkbox, title + repo/
 * #PR/branch/author meta, timestamp + bookmark, then a bordered badges row (status,
 * findings-count toggle, priority, diff stats) with hover quick-actions + "Review
 * now". The compact row collapses that to one annotated line.
 */

type Tone = 'amber' | 'blue' | 'emerald';

interface ReviewCardProps {
  readonly review: ReviewsListItem;
  readonly viewMode: 'detailed' | 'compact';
  readonly isSelected: boolean;
  readonly isBookmarked: boolean;
  readonly onToggleSelect: (id: string) => void;
  readonly onToggleBookmark: (id: string) => void;
  readonly onQuickDecision: (id: string, decision: ReviewDecision) => void;
}

const VERDICT: Record<
  ReviewsListItem['overallVerdict'],
  { tone: Tone; label: string; color: string }
> = {
  REQUEST_CHANGES: {
    tone: 'amber',
    label: 'Request changes',
    color: 'var(--verdict-request-changes)',
  },
  COMMENT: { tone: 'blue', label: 'Comment', color: 'var(--verdict-comment)' },
  APPROVE: { tone: 'emerald', label: 'Approve', color: 'var(--verdict-approve)' },
};

const PRIORITY: Record<PriorityLevel, { label: string; cls: string }> = {
  high: { label: 'High priority', cls: 'rq-priority--high' },
  medium: { label: 'Medium priority', cls: 'rq-priority--medium' },
  low: { label: 'Low priority', cls: 'rq-priority--low' },
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const minutes = Math.floor(secs / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2'];

function avatarColor(name: string | null): string {
  if (!name) return 'var(--color-text-faint)';
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function ReviewCard({
  review,
  viewMode,
  isSelected,
  isBookmarked,
  onToggleSelect,
  onToggleBookmark,
  onQuickDecision,
}: ReviewCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const verdict = VERDICT[review.overallVerdict];
  const priority = PRIORITY[review.priority];
  const reviewPath = `/reviews/${review.id}`;

  if (viewMode === 'compact') {
    const StatusIcon =
      verdict.tone === 'amber'
        ? AlertTriangle
        : verdict.tone === 'emerald'
          ? CheckCircle2
          : MessageSquare;
    return (
      <li className="rq-compact" data-tone={verdict.tone}>
        <div className="rq-compact-main">
          <span className="rq-compact-status" style={{ color: verdict.color }} aria-hidden="true">
            <StatusIcon />
          </span>
          <Link to={reviewPath} className="rq-compact-title">
            {review.prTitle}
          </Link>
          <span className="rq-compact-prnum">#{review.prNumber}</span>
          <span className={`rq-priority ${priority.cls}`}>
            <span className="rq-priority-dot" aria-hidden="true" />
            {priority.label}
          </span>
          <span className="rq-compact-findings">{review.findingCount} findings</span>
        </div>
        <time className="rq-compact-time">{timeAgo(review.createdAt)}</time>
        <button
          type="button"
          className="rq-compact-action"
          onClick={() => onQuickDecision(review.id, 'APPROVE')}
        >
          Review
        </button>
      </li>
    );
  }

  return (
    <li className={`rq-card${isSelected ? ' rq-card--selected' : ''}`} data-tone={verdict.tone}>
      <span className={`rq-card-strip rq-card-strip--${verdict.tone}`} aria-hidden="true" />
      <div className="rq-card-body">
        <div className="rq-card-head">
          <div className="rq-card-head-left">
            <button
              type="button"
              className="rq-card-checkbox"
              onClick={() => onToggleSelect(review.id)}
              aria-label="Select review"
              aria-pressed={isSelected}
            >
              {isSelected ? (
                <CheckSquare className="rq-checkbox" />
              ) : (
                <Square className="rq-checkbox" />
              )}
            </button>
            <div className="rq-card-title-col">
              <Link to={reviewPath} className="rq-card-title">
                {review.prTitle}
              </Link>
              <div className="rq-card-meta">
                <a className="rq-card-repo" href={review.prUrl} target="_blank" rel="noreferrer">
                  <span>{review.repo}</span>
                  <ExternalLink />
                </a>
                <span className="rq-card-prnum">#{review.prNumber}</span>
                {review.branch.source && (
                  <>
                    <span className="rq-card-sep">·</span>
                    <span className="rq-card-branch">
                      <GitBranch />
                      <span>{review.branch.source}</span>
                      {review.branch.target && (
                        <>
                          <span className="rq-card-arrow">→</span>
                          <span>{review.branch.target}</span>
                        </>
                      )}
                    </span>
                  </>
                )}
                {review.author && (
                  <>
                    <span className="rq-card-sep">·</span>
                    <span className="rq-card-author">
                      <span
                        className="rq-card-author-avatar"
                        style={{ background: avatarColor(review.author) }}
                        aria-hidden="true"
                      >
                        {initials(review.author)}
                      </span>
                      <span className="rq-card-author-name">{review.author}</span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="rq-card-head-right">
            <time className="rq-card-time">{timeAgo(review.createdAt)}</time>
            <button
              type="button"
              className={`rq-bookmark${isBookmarked ? ' rq-bookmark--active' : ''}`}
              onClick={() => onToggleBookmark(review.id)}
              aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark review'}
              aria-pressed={isBookmarked}
            >
              <Bookmark />
            </button>
          </div>
        </div>

        <div className="rq-card-badges">
          <div className="rq-card-badges-left">
            <span className={`rq-status-badge rq-status-badge--${verdict.tone}`}>
              <span className="dot" style={{ background: verdict.color }} aria-hidden="true" />
              {verdict.label}
            </span>
            {review.triage.securityBlocked && (
              <span
                className="rq-triage-badge rq-triage-badge--security"
                title="Security triage rule fired"
              >
                <ShieldAlert size={13} />
                Security block
              </span>
            )}
            {review.triage.schemaGate && (
              <span
                className="rq-triage-badge rq-triage-badge--schema"
                title="Schema/data-integrity rule fired"
              >
                <Sliders size={13} />
                Schema
              </span>
            )}
            <button
              type="button"
              className="rq-findings-pill"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp /> : <ChevronDown />}
              <span>
                {review.findingCount} {review.findingCount === 1 ? 'finding' : 'findings'}
              </span>
            </button>
            <span className={`rq-priority ${priority.cls}`}>
              <span className="rq-priority-dot" aria-hidden="true" />
              {priority.label}
            </span>
            <span className="rq-diff">
              <span className="rq-diff-add">+{review.additions}</span>
              <span className="rq-diff-del">-{review.deletions}</span>
              <span className="rq-diff-files">
                ({review.filesChanged} {review.filesChanged === 1 ? 'file' : 'files'})
              </span>
            </span>
          </div>
          <div className="rq-card-badges-right">
            {review.riskScore >= 70 && <span className="rq-risk">Risk {review.riskScore}/100</span>}
            <div className="rq-quick-actions">
              <button
                type="button"
                className="rq-quick-btn rq-quick-btn--approve"
                onClick={() => onQuickDecision(review.id, 'APPROVE')}
                aria-label="Approve review"
              >
                <Check />
              </button>
              <button
                type="button"
                className="rq-quick-btn rq-quick-btn--changes"
                onClick={() => onQuickDecision(review.id, 'REQUEST_CHANGES')}
                aria-label="Request changes"
              >
                <X />
              </button>
            </div>
            <Link to={reviewPath} className="rq-review-btn">
              Review now <ArrowRight />
            </Link>
          </div>
        </div>

        {expanded && review.findings.length > 0 && (
          <div className="rq-findings">
            <div className="rq-findings-head">
              <span className="rq-findings-head-title">
                <MessageSquare /> AI Findings Summary
              </span>
              <span className="rq-findings-hint">
                {review.findings.length} of {review.findingCount}
              </span>
            </div>
            <div className="rq-findings-list">
              {review.findings.map((finding, index) => (
                <div className="rq-finding" key={`${finding.file}:${finding.line ?? ''}:${index}`}>
                  <div className="rq-finding-left">
                    <span
                      className={`rq-finding-sev ${
                        finding.severity === 'CRITICAL'
                          ? 'rq-finding-sev--critical'
                          : 'rq-finding-sev--other'
                      }`}
                    >
                      {finding.severity}
                    </span>
                    <div className="rq-finding-body">
                      <span className="rq-finding-title">{finding.message}</span>
                      <span className="rq-finding-loc">
                        {finding.file}
                        {finding.line != null ? `:${finding.line}` : ''}
                      </span>
                    </div>
                  </div>
                  <span className="rq-finding-cat">{finding.kind}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
