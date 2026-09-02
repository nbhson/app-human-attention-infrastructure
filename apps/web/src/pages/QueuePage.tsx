import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { reviewsApi, type ReviewDecision, type ReviewsListItem } from '../api/reviews';
import { CheckCircle2, Search } from '../components/Icons';
import { ReviewCard } from '../components/ReviewCard';
import { ReviewQueueHeader } from '../components/ReviewQueueHeader';
import {
  ReviewQueueFilters,
  type PriorityFilter,
  type SortKey,
  type StatusFilter,
  type ViewMode,
} from '../components/ReviewQueueFilters';
import { Skeleton } from '../components/Skeleton';
import { Toast, useToast } from '../components/Toast';

/**
 * Review Queue — the landing surface. Owns all filter/sort/selection/bookmark
 * state, fetches the pending list (polled) + summary counts, and wires the
 * header, filters, and cards. Quick and bulk decisions are real `POST …/decision`
 * calls that invalidate the pending + summary queries and toast the outcome.
 */

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const VERDICT_RANK: Record<string, number> = { REQUEST_CHANGES: 0, COMMENT: 1, APPROVE: 2 };

function sortReviews(items: readonly ReviewsListItem[], sortBy: SortKey): ReviewsListItem[] {
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'newest':
        return +new Date(b.createdAt) - +new Date(a.createdAt);
      case 'findings':
        return b.findingCount - a.findingCount || b.riskScore - a.riskScore;
      case 'prNumber':
        return b.prNumber - a.prNumber;
      case 'urgency':
      default:
        return (
          (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) ||
          b.riskScore - a.riskScore ||
          (VERDICT_RANK[a.overallVerdict] ?? 3) - (VERDICT_RANK[b.overallVerdict] ?? 3) ||
          b.findingCount - a.findingCount
        );
    }
  });
}

export default function QueuePage(): JSX.Element {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [selectedRepo, setSelectedRepo] = useState('all');
  const [sortBy, setSortBy] = useState<SortKey>('urgency');
  const [viewMode, setViewMode] = useState<ViewMode>('detailed');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [bookmarks, setBookmarks] = useState<ReadonlySet<string>>(() => new Set());
  const { toast, showToast, dismissToast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const {
    data: reviews = [],
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['pendingReviews'],
    queryFn: () => reviewsApi.list(true),
    refetchInterval: 5000,
  });

  const { data: summary } = useQuery({
    queryKey: ['reviewsSummary'],
    queryFn: () => reviewsApi.summary(),
  });

  const sorted = useMemo(() => sortReviews(reviews, sortBy), [reviews, sortBy]);

  const repos = useMemo(() => {
    const set = new Set<string>();
    for (const review of reviews) set.add(review.repo);
    return [...set].sort();
  }, [reviews]);

  const counts = useMemo<Record<StatusFilter, number>>(() => {
    const result: Record<StatusFilter, number> = {
      all: reviews.length,
      REQUEST_CHANGES: 0,
      COMMENT: 0,
      APPROVE: 0,
    };
    for (const review of reviews) {
      if (review.overallVerdict === 'REQUEST_CHANGES') result.REQUEST_CHANGES += 1;
      else if (review.overallVerdict === 'COMMENT') result.COMMENT += 1;
      else if (review.overallVerdict === 'APPROVE') result.APPROVE += 1;
    }
    return result;
  }, [reviews]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return sorted.filter((review) => {
      if (statusFilter !== 'all' && review.overallVerdict !== statusFilter) return false;
      if (priorityFilter !== 'all' && review.priority !== priorityFilter) return false;
      if (selectedRepo !== 'all' && review.repo !== selectedRepo) return false;
      if (query) {
        const haystack = `${review.prTitle} ${review.repo} ${review.author ?? ''} #${review.prNumber}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [sorted, statusFilter, priorityFilter, selectedRepo, searchQuery]);

  const allSelected = filtered.length > 0 && filtered.every((review) => selectedIds.has(review.id));

  const decide = useCallback(
    async (id: string, decision: ReviewDecision, message: string) => {
      try {
        await reviewsApi.decide(id, { decision });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['pendingReviews'] }),
          queryClient.invalidateQueries({ queryKey: ['reviewsSummary'] }),
        ]);
        showToast(message);
      } catch {
        showToast('Decision failed — try again', 'warning');
      }
    },
    [queryClient, showToast],
  );

  const handleQuickDecision = useCallback(
    (id: string, decision: ReviewDecision) => {
      void decide(id, decision, decision === 'APPROVE' ? 'Review approved' : 'Changes requested');
    },
    [decide],
  );

  const handleBulkDecision = useCallback(
    async (decision: Extract<ReviewDecision, 'APPROVE' | 'REQUEST_CHANGES'>) => {
      const ids = [...selectedIds];
      if (ids.length === 0) return;
      try {
        await Promise.all(ids.map((id) => reviewsApi.decide(id, { decision })));
        setSelectedIds(new Set());
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['pendingReviews'] }),
          queryClient.invalidateQueries({ queryKey: ['reviewsSummary'] }),
        ]);
        showToast(
          `${ids.length} ${ids.length === 1 ? 'review' : 'reviews'} ${decision === 'APPROVE' ? 'approved' : 'updated'}`,
        );
      } catch {
        showToast('Bulk decision failed — try again', 'warning');
      }
    },
    [selectedIds, queryClient, showToast],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const review of filtered) next.delete(review.id);
      } else {
        for (const review of filtered) next.add(review.id);
      }
      return next;
    });
  }, [allSelected, filtered]);

  const toggleBookmark = useCallback((id: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const typing =
        target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setSelectedRepo('all');
    setSortBy('urgency');
  }, []);

  return (
    <div className="rq-content">
      <ReviewQueueHeader
        reviews={reviews}
        pendingCount={reviews.length}
        summary={summary}
        isRefreshing={isFetching}
        onSync={() => void refetch()}
      />

      <ReviewQueueFilters
        searchQuery={searchQuery}
        onSearchQuery={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityFilter={setPriorityFilter}
        selectedRepo={selectedRepo}
        onSelectedRepo={setSelectedRepo}
        sortBy={sortBy}
        onSortBy={setSortBy}
        viewMode={viewMode}
        onViewMode={setViewMode}
        repos={repos}
        counts={counts}
        selectedCount={selectedIds.size}
        allSelected={allSelected}
        onToggleSelectAll={toggleSelectAll}
        onBulkDecision={handleBulkDecision}
        searchRef={searchRef}
      />

      {isLoading ? (
        <div className="rq-list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rq-card" style={{ padding: 24 }}>
              <Skeleton height={16} width="60%" style={{ marginBottom: 12 }} />
              <Skeleton height={12} width="40%" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rq-empty" role="alert">
          <div className="rq-empty-icon">
            <Search />
          </div>
          <h3 className="rq-empty-title">Couldn't load reviews</h3>
          <p className="rq-empty-text">{error instanceof Error ? error.message : 'Unexpected error'}</p>
          <button type="button" className="rq-empty-reset" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      ) : reviews.length === 0 ? (
        <div className="rq-empty" data-testid="empty-state">
          <div className="rq-empty-icon">
            <CheckCircle2 />
          </div>
          <h3 className="rq-empty-title">You're all caught up</h3>
          <p className="rq-empty-text">no AI reviews waiting for your attention.</p>
          <Link to="/reviews/new" className="rq-empty-reset">
            Create New Review
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rq-empty">
          <div className="rq-empty-icon">
            <Search />
          </div>
          <h3 className="rq-empty-title">No matching pull requests</h3>
          <p className="rq-empty-text">Try adjusting your filters or search query.</p>
          <button type="button" className="rq-empty-reset" onClick={resetFilters}>
            Reset All Filters
          </button>
        </div>
      ) : (
        <ul className="rq-list">
          {filtered.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              viewMode={viewMode}
              isSelected={selectedIds.has(review.id)}
              isBookmarked={bookmarks.has(review.id)}
              onToggleSelect={toggleSelect}
              onToggleBookmark={toggleBookmark}
              onQuickDecision={handleQuickDecision}
            />
          ))}
        </ul>
      )}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  );
}
