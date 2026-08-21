import type { FactorScore } from '../api/review';

/** The five factors with availability markers (day-23 §2.3). */
export function FactorBreakdown({
  factors,
}: {
  readonly factors: readonly FactorScore[];
}): JSX.Element {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {factors.map((factor) => (
        <li
          key={factor.key}
          style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 260 }}
        >
          <span>{factor.key}</span>
          <span data-testid={`factor-${factor.key}`}>
            {factor.available ? factor.score.toFixed(2) : 'unavailable'}
          </span>
        </li>
      ))}
    </ul>
  );
}
