/**
 * Shared environment-variable helpers for the API layer.
 *
 * Pulled out of `bootstrap.ts` / `review-ingest.ts` so there is one source of
 * truth for env parsing and the behaviour is testable (pass `process.env`
 * explicitly).
 */

/** Parse a positive integer env var, or fall back to `fallback`. */
export function envInt(name: string, fallback: number, env = process.env): number {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Coerce an unknown value to a non-negative integer (0 when invalid). */
export function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
