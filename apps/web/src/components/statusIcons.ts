import type { ReviewVerificationStatus } from '../api/reviews';
import type { IconProps } from './Icons';
import { AlertTriangle, ArrowRight, Check, Clock, RefreshCw, X } from './Icons';

/**
 * Shared sandbox-verification status → glanceable icon + label + tone
 * (theme tokens, so it follows dark mode). Previously duplicated in
 * VerificationTab and NewReviewPage; extracted so the two never drift.
 */
export interface VerificationStatusView {
  /** Lucide-style icon component — render as `<view.Icon size={14} />`. */
  readonly Icon: (props: IconProps) => JSX.Element;
  readonly label: string;
  readonly color: string;
}

export const VERIFICATION_STATUS: Record<ReviewVerificationStatus, VerificationStatusView> = {
  PENDING: { Icon: Clock, label: 'pending', color: 'var(--color-text-muted)' },
  RUNNING: { Icon: RefreshCw, label: 'running', color: 'var(--color-info)' },
  PASSED: { Icon: Check, label: 'passed', color: 'var(--color-success)' },
  FAILED: { Icon: X, label: 'failed', color: 'var(--color-danger)' },
  SKIPPED: { Icon: ArrowRight, label: 'skipped', color: 'var(--color-warning)' },
  ERROR: { Icon: AlertTriangle, label: 'error', color: 'var(--color-danger)' },
};

/** One unified tone for the not-yet-started (null) verification run. */
export const VERIFICATION_STARTING: VerificationStatusView = {
  Icon: RefreshCw,
  label: 'starting',
  color: 'var(--color-text-muted)',
};
