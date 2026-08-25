import type { CSSProperties } from 'react';

/**
 * Loading primitives (review-reorient Phase 3). Every screen previously showed a
 * bare `<p>Loading…</p>`; the shimmer below keeps the page's layout stable while a
 * query is in flight, so a slow fetch reads as "still loading" rather than "broken
 * or empty". Compose these into skeletons that mirror the loaded layout.
 */

export function Skeleton({
  width,
  height,
  style,
}: {
  readonly width?: string | number;
  readonly height?: string | number;
  readonly style?: CSSProperties;
}): JSX.Element {
  return (
    <div className="skeleton" style={{ width: width ?? '100%', height: height ?? 12, ...style }} />
  );
}

/** A text line (a `Skeleton` with text-y proportions). */
export function SkeletonLine({ width }: { readonly width?: string | number }): JSX.Element {
  return <Skeleton width={width ?? '80%'} height={12} />;
}

/** Several text lines, for a card/paragraph worth of pending content. */
export function SkeletonLines({
  count = 3,
  widths,
}: {
  readonly count?: number;
  readonly widths?: readonly string[];
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonLine key={index} width={widths?.[index]} />
      ))}
    </div>
  );
}
