/**
 * The write-back gate at review-decision time (review-reorient Phase 3 day-09).
 *
 * Write-back is the one code path that touches an external system, so it fails
 * safe by construction: the *effective* toggle is the conjunction of a
 * request-level flag and a global env ceiling —
 *
 * ```
 * effective = (request.writeback === true) && (WRITEBACK_ENABLED is not '0' | 'false')
 * ```
 *
 * The ceiling is **ON by default** (unset ⇒ on), so the feature ships armed. An
 * operator opts a whole deployment out with `WRITEBACK_ENABLED=0` (or `false`).
 * The per-request flag is still the *human's* choice — a decision that doesn't
 * ask for a write never writes — and the service's own `enabled(provider)` check
 * (`WRITEBACK_<PROVIDER>`, also on-by-default) is a third, per-host confirmation
 * that no write is dispatched by accident (day-09 §2.1, §6; default inverted so
 * write-back works out of the box).
 */

/**
 * Resolve the effective write-back gate for one decision request.
 *
 * @param writeback - the request-level `writeback` flag (missing/falsy ⇒ OFF).
 * @param env - the process environment (injected for testability).
 * @returns true only when both the request asks for a write AND the
 *   `WRITEBACK_ENABLED` ceiling is armed (armed unless set to `0`/`false`).
 */
export function writebackEnabled(writeback: unknown, env: Record<string, string | undefined> = process.env): boolean {
  const ceiling = env['WRITEBACK_ENABLED'];
  const ceilingOn = ceiling !== '0' && ceiling !== 'false';
  return writeback === true && ceilingOn;
}
