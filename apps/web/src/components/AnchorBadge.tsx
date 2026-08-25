import type { FindingAnchor } from '../api/reviews';

/**
 * Trust-loop anchor badge (review-reorient Phase 3) — turns a finding's
 * `verified` / `unverified` anchor verdict into a glanceable pill. Green = the
 * AI's `file:line` resolved into the PR diff; amber = it did not (the claim may
 * be hallucinated). Theme tokens, so it follows dark mode automatically.
 */

const TONE: Record<
  FindingAnchor['status'],
  {
    readonly icon: string;
    readonly label: string;
    readonly color: string;
    readonly background: string;
  }
> = {
  verified: {
    icon: '✓',
    label: 'verified',
    color: 'var(--color-success)',
    background: 'transparent',
  },
  unverified: {
    icon: '⚠',
    label: 'unverified',
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
      <span aria-hidden="true">{tone.icon}</span>
      {tone.label}
    </span>
  );
}
