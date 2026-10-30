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
 * P0 security fix — the ceiling is **OFF by default** (unset ⇒ disarmed): an
 * accidental or under-configured deployment can never write to an external
 * system, because no environment layer is armed without an explicit act. An
 * operator arms a deployment with `WRITEBACK_ENABLED=1` (or `true`) — `.env`
 * in development carries exactly that line, so the local UX is unchanged.
 * The per-request flag is still the *human's* per-decision choice — a decision
 * that doesn't ask for a write never writes — and the service's own
 * `enabled(provider)` check (`WRITEBACK_<PROVIDER>`, opt-out) is a third,
 * per-host confirmation that no write is dispatched by accident (day-09 §2.1,
 * §6; per-provider stays opt-out because the ceiling is now the explicit arm).
 */

/**
 * Resolve the effective write-back gate for one decision request.
 *
 * @param writeback - the request-level `writeback` flag (missing/falsy ⇒ OFF).
 * @param env - the process environment (injected for testability).
 * @returns true only when the request asks for a write AND the
 *   `WRITEBACK_ENABLED` ceiling is explicitly armed (`1`/`true`,
 *   case-insensitive). Unset or any other value ⇒ OFF.
 */
export function writebackEnabled(writeback: unknown, env: Record<string, string | undefined> = process.env): boolean {
  const ceiling = env['WRITEBACK_ENABLED']?.toLowerCase();
  const ceilingOn = ceiling === '1' || ceiling === 'true';
  return writeback === true && ceilingOn;
}
