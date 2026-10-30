import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { reviewsApi, type ReviewDecision } from '../api/reviews';

/** How often to poll for an in-progress report (ms). */
const PENDING_POLL_MS = 3_000;

/**
 * Data + intent state for the review report page: the report query (with its
 * pending-status polling), the retry path, and the human-decision form state.
 * Everything the report page renders is derived from what this hook returns.
 */
export function useReviewReport(): {
  id: string;
  data: Awaited<ReturnType<typeof reviewsApi.getReport>> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  decision: ReviewDecision | null;
  setDecision: (decision: ReviewDecision) => void;
  writeback: boolean;
  setWriteback: (writeback: boolean) => void;
  comment: string;
  setComment: (comment: string) => void;
  submitError: string | null;
  submitDecision: () => void;
  submitting: boolean;
  retryReport: () => void;
  retrying: boolean;
} {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [writeback, setWriteback] = useState(true);
  const [comment, setComment] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['reviewReport', id],
    queryFn: () => reviewsApi.getReport(id),
    enabled: id !== '',
    refetchInterval: (query) => {
      const d = query.state.data as { reviewStatus?: string; verification?: { status?: string } | null } | undefined;
      // Poll while the review is still being processed.
      if (!d) {
        return PENDING_POLL_MS;
      }
      if (d.reviewStatus !== 'complete' && d.reviewStatus !== 'error') {
        return PENDING_POLL_MS;
      }
      if (d.reviewStatus === 'error') {
        return false;
      }
      // Report is complete but sandbox verification runs fire-and-forget after
      // it — keep polling while that run has not reached a terminal state so
      // the Verification tab never looks stuck at "running".
      const vStatus = d.verification?.status;
      if (vStatus === 'RUNNING' || vStatus === 'PENDING') {
        return PENDING_POLL_MS;
      }
      return false;
    },
  });

  const decide = useMutation({
    mutationFn: () => reviewsApi.decide(id, { decision: decision as ReviewDecision, writeback, comment }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviewReport', id] }),
    onError: (error: unknown) => setSubmitError(error instanceof Error ? error.message : 'Decision failed.'),
  });

  const retry = useMutation({
    mutationFn: () => reviewsApi.retry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviewReport', id] }),
    onError: (error: unknown) => setSubmitError(error instanceof Error ? error.message : 'Retry failed.'),
  });

  return {
    id,
    data,
    isLoading,
    isError,
    error,
    refetch: () => void refetch(),
    decision,
    setDecision,
    writeback,
    setWriteback,
    comment,
    setComment,
    submitError,
    submitDecision: () => void decide.mutate(),
    submitting: decide.isPending,
    retryReport: () => void retry.mutate(),
    retrying: retry.isPending,
  };
}
