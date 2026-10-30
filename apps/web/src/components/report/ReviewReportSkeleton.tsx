import { Skeleton, SkeletonLines } from '../Skeleton';

/** Loading placeholder mirroring the report's four-part layout. */
export function ReviewReportSkeleton(): JSX.Element {
  const block = { borderRadius: 12 } as const;
  const twoCol = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginTop: 16,
  } as const;
  return (
    <main
      role="status"
      aria-label="Loading review report"
      style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 16px 0' }}
    >
      {/* back link */}
      <Skeleton width={116} height={30} style={{ borderRadius: 8 }} />

      {/* PR title + meta line */}
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 9 }}>
        <Skeleton width="62%" height={26} />
        <Skeleton width="38%" height={13} />
      </div>

      {/* verdict / attention hero */}
      <Skeleton height={180} style={{ ...block, marginTop: 18 }} />

      {/* summary + metrics visualization */}
      <div style={twoCol}>
        <Skeleton height={144} style={block} />
        <Skeleton height={144} style={block} />
      </div>

      {/* investigation tabs */}
      <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
        {['Review', 'Detail', 'Verification (sandbox)', 'Diff', 'Breakdown', 'AI trace'].map((label, index) => (
          <Skeleton key={label} height={32} style={{ borderRadius: 8, width: [72, 72, 160, 64, 98, 82][index] }} />
        ))}
      </div>

      {/* findings list + detail pane */}
      <div style={twoCol}>
        <div style={{ display: 'grid', gap: 8 }}>
          <SkeletonLines count={5} />
        </div>
        <Skeleton height={180} style={block} />
      </div>
    </main>
  );
}
