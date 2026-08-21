/**
 * Two-level timeout plumbing (day-15 §2.2, §5.7).
 *
 * Level 1 is **per-check**: each check is raced against its own `timeoutMs`.
 * Level 2 is **request-level**: the whole `Promise.all` over checks is raced
 * against `VERIFY_REQUEST_TIMEOUT_MS`. Both rejections carry a distinguishable
 * error type so the engine can build a `TIMED_OUT` report rather than hang.
 */

/** A single check exceeded its own budget (level 1). */
export class CheckTimeoutError extends Error {
  override readonly name = 'CheckTimeoutError';
  constructor(readonly checkKind: string) {
    super(`check timed out: ${checkKind}`);
  }
}

/** The whole verification request exceeded its budget (level 2). */
export class RequestTimeoutError extends Error {
  override readonly name = 'RequestTimeoutError';
  constructor() {
    super('verification request timed out');
  }
}

/**
 * Race `promise` against a `ms` deadline. Resolves with the promise's value, or
 * rejects with `onTimeout()` once the deadline elapses. `ms <= 0` disables the
 * timeout. The timer is cleared when the promise settles first, so a fast
 * operation never leaves a stray timeout keeping the process alive.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  if (ms <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
