import type { RefObject } from 'react';

import type { PriorityLevel } from '../api/reviews';
import { CheckSquare, Layers, List, Search, Square, X } from './Icons';

/**
 * Filter + control bar for the queue. The status pills replicate the mockup's
 * filled colours; active pills use an `aria-label` matching just the label so the
 * accessible name stays stable when the count chip changes. All filtering state
 * is lifted to `QueuePage`.
 */

export type StatusFilter = 'all' | 'REQUEST_CHANGES' | 'COMMENT' | 'APPROVE';
export type PriorityFilter = 'all' | PriorityLevel;
export type SortKey = 'urgency' | 'newest' | 'findings' | 'prNumber';
export type ViewMode = 'detailed' | 'compact';

interface Pill {
  readonly key: StatusFilter;
  readonly label: string;
  readonly dot: string | null;
  readonly activeBg: string;
  readonly activeCountBg: string;
  readonly activeCountColor: string;
}

const PILLS: readonly Pill[] = [
  {
    key: 'all',
    label: 'All',
    dot: null,
    activeBg: 'var(--accent)',
    activeCountBg: 'var(--color-bg)',
    activeCountColor: 'var(--color-text)',
  },
  {
    key: 'REQUEST_CHANGES',
    label: 'Request changes',
    dot: 'var(--verdict-request-changes)',
    activeBg: 'var(--verdict-request-changes)',
    activeCountBg: 'var(--color-surface)',
    activeCountColor: 'var(--color-text)',
  },
  {
    key: 'COMMENT',
    label: 'Comment',
    dot: 'var(--verdict-comment)',
    activeBg: 'var(--verdict-comment)',
    activeCountBg: 'var(--color-surface)',
    activeCountColor: 'var(--color-text)',
  },
  {
    key: 'APPROVE',
    label: 'Approve',
    dot: 'var(--verdict-approve)',
    activeBg: 'var(--verdict-approve)',
    activeCountBg: 'var(--color-bg)',
    activeCountColor: 'var(--color-text)',
  },
];

interface ReviewQueueFiltersProps {
  readonly searchQuery: string;
  readonly onSearchQuery: (value: string) => void;
  readonly statusFilter: StatusFilter;
  readonly onStatusFilter: (value: StatusFilter) => void;
  readonly priorityFilter: PriorityFilter;
  readonly onPriorityFilter: (value: PriorityFilter) => void;
  readonly selectedRepo: string;
  readonly onSelectedRepo: (value: string) => void;
  readonly sortBy: SortKey;
  readonly onSortBy: (value: SortKey) => void;
  readonly viewMode: ViewMode;
  readonly onViewMode: (value: ViewMode) => void;
  readonly repos: readonly string[];
  readonly counts: Readonly<Record<StatusFilter, number>>;
  readonly selectedCount: number;
  readonly allSelected: boolean;
  readonly onToggleSelectAll: () => void;
  readonly onBulkDecision: (decision: 'APPROVE' | 'REQUEST_CHANGES') => void;
  readonly searchRef: RefObject<HTMLInputElement>;
}

export function ReviewQueueFilters(props: ReviewQueueFiltersProps): JSX.Element {
  const {
    searchQuery,
    onSearchQuery,
    statusFilter,
    onStatusFilter,
    priorityFilter,
    onPriorityFilter,
    selectedRepo,
    onSelectedRepo,
    sortBy,
    onSortBy,
    viewMode,
    onViewMode,
    repos,
    counts,
    selectedCount,
    allSelected,
    onToggleSelectAll,
    onBulkDecision,
    searchRef,
  } = props;

  return (
    <div className="rq-filters">
      <div className="rq-filters-row">
        <div className="rq-search">
          <span className="rq-search-icon" aria-hidden="true">
            <Search />
          </span>
          <input
            ref={searchRef}
            className="rq-search-input"
            type="text"
            aria-label="Search reviews"
            placeholder="Search by title, repo, author, or #PR…"
            value={searchQuery}
            onChange={(e) => onSearchQuery(e.target.value)}
          />
          {searchQuery ? (
            <button
              type="button"
              className="rq-search-clear"
              onClick={() => onSearchQuery('')}
              aria-label="Clear search"
            >
              <X />
            </button>
          ) : (
            <span className="rq-search-kbd" aria-hidden="true">
              /
            </span>
          )}
        </div>

        <div className="rq-pills" role="group" aria-label="Filter by verdict">
          {PILLS.map((pill) => {
            const active = statusFilter === pill.key;
            return (
              <button
                key={pill.key}
                type="button"
                className={`rq-pill ${active ? 'rq-pill--active' : 'rq-pill--idle'}`}
                aria-label={pill.label}
                aria-pressed={active}
                style={active ? { background: pill.activeBg, color: 'var(--color-on-accent)' } : undefined}
                onClick={() => onStatusFilter(pill.key)}
              >
                {pill.dot && <span className="rq-pill-dot" style={{ background: pill.dot }} aria-hidden="true" />}
                <span>{pill.label}</span>
                <span
                  className="rq-pill-count"
                  style={active ? { background: pill.activeCountBg, color: pill.activeCountColor } : undefined}
                >
                  {counts[pill.key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rq-secondary">
        <div className="rq-secondary-left">
          <button type="button" className="rq-select-all" onClick={onToggleSelectAll} aria-pressed={allSelected}>
            {allSelected ? <CheckSquare className="rq-checkbox" /> : <Square className="rq-checkbox" />}
            <span>Select all</span>
          </button>

          <label className="rq-select">
            <span className="rq-select-label">Repo</span>
            <select
              value={selectedRepo}
              onChange={(e) => onSelectedRepo(e.target.value)}
              aria-label="Filter by repository"
            >
              <option value="all">All repos</option>
              {repos.map((repo) => (
                <option key={repo} value={repo}>
                  {repo}
                </option>
              ))}
            </select>
          </label>

          <label className="rq-select">
            <span className="rq-select-label">Priority</span>
            <select
              value={priorityFilter}
              onChange={(e) => onPriorityFilter(e.target.value as PriorityFilter)}
              aria-label="Filter by priority"
            >
              <option value="all">All</option>
              <option value="high" style={{ color: 'var(--prio-high)' }}>
                High
              </option>
              <option value="medium" style={{ color: 'var(--prio-medium)' }}>
                Medium
              </option>
              <option value="low" style={{ color: 'var(--prio-low)' }}>
                Low
              </option>
            </select>
          </label>

          <label className="rq-select">
            <span className="rq-select-label">Sort</span>
            <select value={sortBy} onChange={(e) => onSortBy(e.target.value as SortKey)} aria-label="Sort reviews">
              <option value="urgency">Urgency</option>
              <option value="newest">Newest</option>
              <option value="findings">Findings</option>
              <option value="prNumber">PR #</option>
            </select>
          </label>

          {selectedCount > 0 && (
            <div className="rq-bulk">
              <span className="rq-bulk-count">{selectedCount} selected</span>
              <button
                type="button"
                className="rq-bulk-btn rq-bulk-btn--approve"
                onClick={() => onBulkDecision('APPROVE')}
              >
                Approve
              </button>
              <button
                type="button"
                className="rq-bulk-btn rq-bulk-btn--changes"
                onClick={() => onBulkDecision('REQUEST_CHANGES')}
              >
                Request changes
              </button>
            </div>
          )}
        </div>

        <div className="rq-secondary-right">
          <div className="rq-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={`rq-view-btn ${viewMode === 'detailed' ? 'rq-view-btn--active' : ''}`}
              onClick={() => onViewMode('detailed')}
              aria-label="Detailed view"
              aria-pressed={viewMode === 'detailed'}
            >
              <Layers />
            </button>
            <button
              type="button"
              className={`rq-view-btn ${viewMode === 'compact' ? 'rq-view-btn--active' : ''}`}
              onClick={() => onViewMode('compact')}
              aria-label="Compact list"
              aria-pressed={viewMode === 'compact'}
            >
              <List />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
