/**
 * The write-back gate at review-decision time (review-reorient Phase 3 day-09).
 *
 * Write-back is the one code path that touches an external system, so it fails
 * safe by construction: the *effective* toggle is the conjunction of a
 * request-level flag and a global env ceiling —
 *
 * ```
 * effective = (request.writeback === true) && (WRITEBACK_ENABLED is '1' | 'true')
 * ```
 *
 * `WRITEBACK_ENABLED` is OFF at rest (unset ⇒ off), so a request-level ON is
 * defeated unless an operator has explicitly armed the whole deployment. The
 * per-request flag is the *human's* choice; the env ceiling is the operator's —
 * and the service's own `enabled(provider)` check (`WRITEBACK_<PROVIDER>`) is a
 * third, per-host confirmation that no write is dispatched by accident (day-09
 * §2.1, §6).
 */

/**
 * Resolve the effective write-back gate for one decision request.
 *
 * @param writeback - the request-level `writeback` flag (missing/falsy ⇒ OFF).
 * @param env - the process environment (injected for testability).
 * @returns true only when both the request asks for a write AND the
 *   `WRITEBACK_ENABLED` env ceiling is armed.
 */
export function writebackEnabled(
  writeback: unknown,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const ceiling = env['WRITEBACK_ENABLED'];
  const ceilingOn = ceiling === '1' || ceiling === 'true';
  return writeback === true && ceilingOn;
}
