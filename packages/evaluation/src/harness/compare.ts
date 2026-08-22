/**
 * Head-to-head comparator (day-09 §2.3).
 *
 * Scores variant A vs B on the *predefined* metric and emits a go/no-go result.
 * The gate is singular and fixed up front — the metric is carried in the
 * experiment row before any run executes, so a variant can only win on the metric
 * somebody named, never on a post-hoc denominator (§6, Spec 11 §5).
 *
 * Pure: given the same two values it always emits the same outcome. `go` means
 * "B beats A" for a higher-is-better metric. `noProductionEffect` is *measured* by
 * the harness (live row counts unchanged) and carried through here, not assumed.
 */

export interface AbOutcome {
  readonly experimentId: string;
  readonly metric: string;
  readonly aValue: number;
  readonly bValue: number;
  /** `bValue - aValue`: positive means B leads. */
  readonly delta: number;
  readonly winner: 'A' | 'B' | 'TIE';
  /** True iff B > A (higher-is-better). */
  readonly go: boolean;
  /** Asserted by the harness's isolation measurement — always true in a shadow run. */
  readonly noProductionEffect: boolean;
}

export interface CompareInput {
  readonly experimentId: string;
  readonly metric: string;
  readonly aValue: number;
  readonly bValue: number;
  readonly noProductionEffect: boolean;
}

export function compare(input: CompareInput): AbOutcome {
  const delta = input.bValue - input.aValue;
  const winner = delta > 0 ? 'B' : delta < 0 ? 'A' : 'TIE';
  return {
    experimentId: input.experimentId,
    metric: input.metric,
    aValue: input.aValue,
    bValue: input.bValue,
    delta,
    winner,
    go: delta > 0,
    noProductionEffect: input.noProductionEffect,
  };
}
