/**
 * An explicit result type for pure domain logic.
 *
 * Rather than throwing exceptions (or returning `null`), functions that can fail
 * return a `Result<T, E>` — a discriminated union that forces callers to handle
 * both the success and failure paths before touching the payload. This is the
 * preferred error channel for the "logic" layer of the domain, while I/O and
 * orchestration layers may still throw.
 */

/**
 * A success or failure result.
 *
 * @typeParam T - the success value type.
 * @typeParam E - the error type (defaults to `Error`).
 */
export type Result<T, E = Error> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * Build a successful {@link Result}.
 *
 * @typeParam T - the value type.
 * @param value - the success value.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Build a failed {@link Result}.
 *
 * @typeParam E - the error type.
 * @param error - the error value.
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Type guard: `true` when the result is a success.
 *
 * @typeParam T - the success value type.
 * @typeParam E - the error type.
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

/**
 * Type guard: `true` when the result is a failure.
 *
 * @typeParam T - the success value type.
 * @typeParam E - the error type.
 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

/**
 * Map the success value of a {@link Result}, leaving the error untouched.
 *
 * @typeParam T - input success type.
 * @typeParam U - output success type.
 * @typeParam E - error type.
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Return the success value, or a fallback when the result is a failure.
 *
 * @typeParam T - the success value type.
 * @typeParam E - the error type.
 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
