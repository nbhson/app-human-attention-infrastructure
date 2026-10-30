import type { FindingAnchor } from '../api/reviews';
import type { IconProps } from './Icons';
import { AlertTriangle, Check } from './Icons';

/**
 * Trust-loop anchor badge (review-reorient Phase 3) — turns a finding's
 * anchor verdict (did the AI's `file:line` resolve into the PR diff?) into a
 * glanceable pill. "anchored" = the line is in the diff; "not anchored" = it is
 * not (the claim may be hallucinated) — evidence anchoring, NOT a test run.
 * Theme tokens, so it follows dark mode automatically.
 */

const TONE: Record<
  FindingAnchor['status'],
  {
    readonly Icon: (props: IconProps) => JSX.Element;
    readonly label: string;
    readonly color: string;
    readonly background: string;
  }
> = {
  verified: {
    Icon: Check,
    label: 'anchored',
    color: 'var(--color-success)',
    background: 'transparent',
  },
  unverified: {
    Icon: AlertTriangle,
    label: 'not anchored',
    color: 'var(--color-warning)',
    background: 'var(--color-warning-bg)',
  },
};

export function AnchorBadge({ anchor }: { readonly anchor: FindingAnchor }): JSX.Element {
  const tone = TONE[anchor.status];
  return (
    <span
      data-testid={`anchor-${anchor.status}`}
      title={anchor.detail}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 8px',
        borderRadius: '999px',
        border: `1px solid ${tone.color}`,
        background: tone.background,
        color: tone.color,
        fontSize: '0.7rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">
        <tone.Icon size={12} />
      </span>
      {tone.label}
    </span>
  );
}
