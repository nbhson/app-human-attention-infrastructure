/**
 * Minimal structural logger for the semantic-index subsystem (day-17).
 *
 * The indexer and re-embed listener run in two places: the out-of-band
 * `pnpm embed:populate` CLI (no DI container) and the API bootstrap (which hands
 * them pino via `TOKENS.Logger`). Rather than tie this package to
 * `@harness/di`, the seam is structural — anything with `info`/`warn`/`error`
 * satisfies it, following the same pattern `@harness/db` and `@harness/event-bus`
 * use to accept a logger without importing `di` (boundary R4).
 */

/** The three levels the indexer/listener ever need; pino's `Logger` satisfies it. */
export interface IndexLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
